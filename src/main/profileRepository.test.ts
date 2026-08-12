import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog } from 'electron'
import { createDefaultProfile } from '../shared/defaultProfile'
import type { MappingProfile, ProfileLibrary } from '../shared/contracts'
import { CorruptProfileLibraryError, ProfileRepository } from './profileRepository'

const libraryPath = '/tmp/codex-controller-test/profiles.json'
const legacyLibraryPath = '/tmp/codex-controller-test/controller-controls/profiles.json'

const written = new Map<string, string>()
/**
 * Every filesystem step in order, named by role rather than by path — temporary
 * files carry a pid and a clock reading, which say nothing useful in an
 * assertion.
 */
const operations: string[] = []

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/codex-controller-test' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }
}))

vi.mock('node:fs/promises', () => {
  const missing = (path: string): Error =>
    Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
      code: 'ENOENT'
    })
  /** Yields the event loop, so an unserialised second write can slot in here. */
  const yieldToEventLoop = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
  }
  const readFile = vi.fn(async (path: string): Promise<string> => {
    const value = written.get(path)
    if (value === undefined) throw missing(path)
    return value
  })
  const writeFile = vi.fn(async (path: string, contents: string): Promise<void> => {
    operations.push(path === libraryPath ? 'write library' : 'write temporary')
    await yieldToEventLoop()
    written.set(path, contents)
  })
  const rename = vi.fn(async (from: string, to: string): Promise<void> => {
    const value = written.get(from)
    if (value === undefined) throw missing(from)
    operations.push(to === libraryPath ? 'rename into place' : 'set the library aside')
    await yieldToEventLoop()
    written.set(to, value)
    written.delete(from)
  })
  const unlink = vi.fn(async (path: string): Promise<void> => {
    if (!written.delete(path)) throw missing(path)
  })
  const fs = { readFile, writeFile, rename, unlink }
  return { ...fs, default: fs }
})

const libraryOf = (): ProfileLibrary => {
  const profile = createDefaultProfile()
  return { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
}

/**
 * A library the migration will not touch: one binding is unmistakably the user's
 * own, so the whole profile is left alone rather than adopting the shipped
 * defaults. Anything that survives a load is therefore the saved data itself.
 */
const editedLibraryOf = (): ProfileLibrary => {
  const library = libraryOf()
  const profile = library.profiles[0]!
  return {
    ...library,
    profiles: [
      {
        ...profile,
        bindings: [
          ...profile.bindings.slice(1),
          {
            ...profile.bindings[0]!,
            action: {
              type: 'openWebURL',
              title: 'My dashboard',
              deepLinkURL: 'https://example.com/dashboard'
            }
          }
        ]
      }
    ]
  }
}

const seed = (value: unknown): void => {
  written.set(libraryPath, `${JSON.stringify(value, null, 2)}\n`)
  operations.length = 0
}

const onDisk = (): ProfileLibrary => JSON.parse(written.get(libraryPath)!) as ProfileLibrary

const quarantined = (): string[] =>
  [...written.keys()].filter((path) => path.includes('profiles.json.corrupt-'))

const userBindingTitles = (library: ProfileLibrary): string[] =>
  library.profiles.flatMap((profile) => profile.bindings.map((binding) => binding.action.title))

const sequenceStepIds = (profile: MappingProfile): string[] => {
  const ids: string[] = []
  const visit = (action: MappingProfile['bindings'][number]['action']): void => {
    for (const step of action.sequenceSteps ?? []) {
      ids.push(step.id)
      visit(step.action)
    }
  }
  for (const binding of profile.bindings) visit(binding.action)
  return ids
}

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Deep key reversal: the same library, encoded with every object key reordered. */
const withReversedKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withReversedKeys)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, withReversedKeys(entry)])
    )
  }
  return value
}

beforeEach(() => {
  written.clear()
  operations.length = 0
  vi.mocked(dialog.showOpenDialog).mockReset()
  vi.mocked(dialog.showSaveDialog).mockReset()
})

describe('profile persistence', () => {
  it('accepts the default mappings, including rotation and hold gestures', async () => {
    const repository = new ProfileRepository()
    const saved = await repository.save(libraryOf())

    expect(saved.profiles[0]?.bindings.map((binding) => binding.action.type)).toEqual(
      expect.arrayContaining(['keyboardShortcut', 'primaryClick'])
    )
    expect(
      saved.profiles[0]?.bindings.map((binding) => binding.gesture)
    ).toEqual(
      expect.arrayContaining(['rotateClockwise', 'rotateCounterClockwise', 'holdBegan', 'holdEnded'])
    )
    // Round-trips through the same validation the app loads with.
    expect(await repository.load()).toEqual(saved)
  })

  it('round-trips a shortcut re-recorded on the default-shaped profile', async () => {
    const repository = new ProfileRepository()
    const library = libraryOf()
    const profile = library.profiles[0]!
    const edited: ProfileLibrary = {
      ...library,
      profiles: [
        {
          ...profile,
          bindings: profile.bindings.map((binding) =>
            binding.input === 'rightTrigger'
              ? {
                  ...binding,
                  action: {
                    ...binding.action,
                    shortcut: {
                      keyCode: 0x10,
                      keyDisplay: 'Y',
                      modifiers: ['control', 'option']
                    }
                  }
                }
              : binding
          )
        }
      ]
    }

    await repository.save(edited)
    const loaded = await repository.load()

    expect(
      loaded.profiles[0]?.bindings.find((binding) => binding.input === 'rightTrigger')?.action
        .shortcut
    ).toEqual({
      keyCode: 0x10,
      keyDisplay: 'Y',
      modifiers: ['control', 'option']
    })
  })

  /**
   * The library only ever appears at its real path complete. A plain write to
   * that path can be interrupted — by a crash, a full disk, a forced quit — and
   * what is left behind is a truncated file, which is exactly the input that used
   * to make the next launch throw the whole library away.
   */
  it('writes through a temporary file and renames it into place', async () => {
    const repository = new ProfileRepository()
    await repository.save(libraryOf())

    expect(operations).toEqual(['write temporary', 'rename into place'])
    expect(() => onDisk()).not.toThrow()
  })

  it('creates the defaults when no library has been saved yet', async () => {
    const repository = new ProfileRepository()
    const loaded = await repository.load()

    expect(loaded.profiles).toHaveLength(1)
    expect(onDisk()).toEqual(loaded)
  })

  it('copies the predecessor profile library into the renamed app without deleting it', async () => {
    const repository = new ProfileRepository()
    const legacyLibrary = editedLibraryOf()
    written.set(legacyLibraryPath, `${JSON.stringify(legacyLibrary, null, 2)}\n`)

    const loaded = await repository.load()

    expect(loaded).toEqual(legacyLibrary)
    expect(onDisk()).toEqual(legacyLibrary)
    expect(JSON.parse(written.get(legacyLibraryPath)!)).toEqual(legacyLibrary)
  })

  /**
   * A truncated-file regression case. Reporting the failure is the whole
   * point: the renderer holds autosave off, and the bytes stay on disk to be
   * recovered from.
   */
  it('keeps a truncated library aside and reports the failure', async () => {
    const repository = new ProfileRepository()
    const truncated = `${JSON.stringify(libraryOf(), null, 2).slice(0, 400)}`
    written.set(libraryPath, truncated)
    operations.length = 0

    await expect(repository.load()).rejects.toBeInstanceOf(CorruptProfileLibraryError)

    expect(quarantined()).toHaveLength(1)
    expect(written.get(quarantined()[0]!)).toBe(truncated)
    // Nothing was written over the path — no defaults, no repair attempt.
    expect(operations).toEqual(['set the library aside'])
    expect(written.has(libraryPath)).toBe(false)
  })

  it('keeps a schema-invalid library aside instead of replacing it with defaults', async () => {
    const repository = new ProfileRepository()
    const invalid = { schemaVersion: 1, activeProfileId: 'gone', profiles: [] }
    seed(invalid)

    await expect(repository.load()).rejects.toBeInstanceOf(CorruptProfileLibraryError)

    expect(JSON.parse(written.get(quarantined()[0]!)!)).toEqual(invalid)
    expect(operations).toEqual(['set the library aside'])
  })

  it('names the set-aside file in the error it surfaces to the renderer', async () => {
    const repository = new ProfileRepository()
    written.set(libraryPath, 'not json at all')

    const error = await repository.load().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CorruptProfileLibraryError)
    expect((error as CorruptProfileLibraryError).quarantinePath).toMatch(
      /profiles\.json\.corrupt-/
    )
    expect((error as CorruptProfileLibraryError).quarantinePath).toBe(quarantined()[0])
  })

  /**
   * A read that fails for any reason other than "no file yet" — a permissions
   * problem, a failing disk — is not a corrupt library, and must not be answered
   * by writing anything at all.
   */
  it('propagates an unreadable file without touching it', async () => {
    const repository = new ProfileRepository()
    const { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    )

    await expect(repository.load()).rejects.toThrow('EACCES')
    expect(operations).toEqual([])
  })
})

describe('profile schema migration', () => {
  it('loads a library carrying fields this build has never heard of', async () => {
    const repository = new ProfileRepository()
    const library = editedLibraryOf()
    seed({
      ...library,
      experimentalTelemetry: true,
      profiles: [{ ...library.profiles[0]!, futureSetting: 'from a newer build' }]
    })

    const loaded = await repository.load()

    expect(userBindingTitles(loaded)).toContain('My dashboard')
    expect(loaded.profiles[0]?.bindings).toHaveLength(library.profiles[0]!.bindings.length)
    // The unknown keys are dropped rather than fatal, and the rewrite is clean.
    expect(onDisk()).toEqual(loaded)
    expect(Object.keys(onDisk())).not.toContain('experimentalTelemetry')
  })

  it('migrates a library stamped with a stale schema version', async () => {
    const repository = new ProfileRepository()
    const library = editedLibraryOf()
    seed({
      ...library,
      schemaVersion: 0.5,
      profiles: [{ ...library.profiles[0]!, schemaVersion: 2 }]
    })

    const loaded = await repository.load()

    expect(userBindingTitles(loaded)).toContain('My dashboard')
    expect(loaded.schemaVersion).toBe(1)
    expect(loaded.profiles[0]?.schemaVersion).toBe(4)
    expect(onDisk()).toEqual(loaded)
  })

  it('migrates a profile that predates the schema stamp entirely', async () => {
    const repository = new ProfileRepository()
    const library = editedLibraryOf()
    const { schemaVersion: _profileVersion, ...unstamped } = library.profiles[0]!
    seed({ activeProfileId: library.activeProfileId, profiles: [unstamped] })

    const loaded = await repository.load()

    expect(userBindingTitles(loaded)).toContain('My dashboard')
    expect(loaded.profiles[0]?.schemaVersion).toBe(4)
  })

  /**
   * A library written by a *newer* build is the one case where refusing is the
   * safe answer: restamping it downwards would drop whatever that build added on
   * the next save. It is kept intact and reported, never overwritten.
   */
  it('refuses to downgrade a library stamped newer than this build', async () => {
    const repository = new ProfileRepository()
    const library = editedLibraryOf()
    seed({ ...library, profiles: [{ ...library.profiles[0]!, schemaVersion: 5 }] })

    await expect(repository.load()).rejects.toBeInstanceOf(CorruptProfileLibraryError)

    const preserved = JSON.parse(written.get(quarantined()[0]!)!) as {
      profiles: Array<{ schemaVersion: number }>
    }
    expect(preserved.profiles[0]?.schemaVersion).toBe(5)
  })
})

describe('profile identity validation', () => {
  const importedPath = '/tmp/codex-controller-test/imported-profiles.json'

  const duplicateProfileIds = (): ProfileLibrary => {
    const library = libraryOf()
    return {
      ...library,
      profiles: [
        library.profiles[0]!,
        { ...structuredClone(library.profiles[0]!), name: 'Duplicate id' }
      ]
    }
  }

  const duplicateBindingIds = (): ProfileLibrary => {
    const library = libraryOf()
    const profile = structuredClone(library.profiles[0]!)
    profile.bindings[1] = { ...profile.bindings[1]!, id: profile.bindings[0]!.id }
    return { ...library, profiles: [profile] }
  }

  const duplicateNestedStepIds = (): ProfileLibrary => {
    const library = editedLibraryOf()
    const profile = structuredClone(library.profiles[0]!)
    profile.bindings[0] = {
      ...profile.bindings[0]!,
      action: {
        type: 'sequence',
        title: 'Outer sequence',
        sequenceSteps: [
          {
            id: 'outer',
            delayMilliseconds: 0,
            action: {
              type: 'sequence',
              title: 'Inner sequence',
              sequenceSteps: [0, 1].map((index) => ({
                id: 'duplicate-step',
                delayMilliseconds: index,
                action: { type: 'primaryClick', title: `Click ${index}` },
                focusPolicy: 'focusIfNeeded',
                safety: 'normal'
              }))
            },
            focusPolicy: 'focusIfNeeded',
            safety: 'normal'
          }
        ]
      }
    }
    return { ...library, profiles: [profile] }
  }

  it.each([
    ['profile ids', duplicateProfileIds],
    ['binding ids', duplicateBindingIds],
    ['nested sibling step ids', duplicateNestedStepIds]
  ])('rejects duplicate %s on import without changing the saved library', async (_label, makeImport) => {
    const repository = new ProfileRepository()
    const existing = editedLibraryOf()
    seed(existing)
    const before = written.get(libraryPath)
    written.set(importedPath, `${JSON.stringify(makeImport(), null, 2)}\n`)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [importedPath]
    })

    await expect(repository.import(existing)).rejects.toThrow(/duplicated/)

    expect(written.get(libraryPath)).toBe(before)
    expect(operations).toEqual([])
  })
})

describe('non-destructive profile transfer', () => {
  const importedPath = '/tmp/codex-controller-test/imported-profile.json'
  const exportedPath = '/tmp/codex-controller-test/exported-profile.json'

  const chooseImport = (value: unknown): void => {
    written.set(importedPath, `${JSON.stringify(value, null, 2)}\n`)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [importedPath]
    })
  }

  it('merges one validated profile, regenerates every identity, and saves atomically', async () => {
    const repository = new ProfileRepository()
    const existing = editedLibraryOf()
    const incoming = structuredClone(existing.profiles[0]!)
    incoming.id = 'incoming-profile'
    incoming.bindings[0] = {
      ...incoming.bindings[0]!,
      id: 'incoming-binding',
      action: {
        type: 'sequence',
        title: 'Imported sequence',
        sequenceSteps: [
          {
            id: 'incoming-outer-step',
            delayMilliseconds: 0,
            action: {
              type: 'sequence',
              title: 'Nested sequence',
              sequenceSteps: [
                {
                  id: 'incoming-inner-step',
                  delayMilliseconds: 10,
                  action: { type: 'primaryClick', title: 'Click' },
                  focusPolicy: 'focusIfNeeded',
                  safety: 'normal'
                }
              ]
            },
            focusPolicy: 'focusIfNeeded',
            safety: 'normal'
          }
        ]
      }
    }
    seed(existing)
    chooseImport(incoming)

    const merged = await repository.import(existing)

    expect(merged).not.toBeNull()
    expect(merged!.profiles.slice(0, existing.profiles.length)).toEqual(existing.profiles)
    expect(merged!.profiles).toHaveLength(existing.profiles.length + 1)
    const imported = merged!.profiles.at(-1)!
    expect(merged!.activeProfileId).toBe(imported.id)
    expect(imported.name).toBe(`${incoming.name} (Imported)`)
    expect(imported.id).not.toBe(incoming.id)
    const incomingBindingIds = incoming.bindings.map((binding) => binding.id)
    for (const binding of imported.bindings) {
      expect(incomingBindingIds).not.toContain(binding.id)
    }
    expect(sequenceStepIds(imported)).toHaveLength(2)
    expect(sequenceStepIds(imported)).not.toEqual(sequenceStepIds(incoming))
    expect(sequenceStepIds(imported)).not.toContain('incoming-outer-step')
    expect(sequenceStepIds(imported)).not.toContain('incoming-inner-step')
    expect(onDisk()).toEqual(merged)
    expect(operations).toEqual(['write temporary', 'rename into place'])
  })

  it('imports only the active profile from a legacy whole-library export', async () => {
    const repository = new ProfileRepository()
    const existing = editedLibraryOf()
    const ignored = createDefaultProfile()
    ignored.name = 'Inactive legacy profile'
    const selected = createDefaultProfile()
    selected.name = 'Selected legacy profile'
    const legacy: ProfileLibrary = {
      schemaVersion: 1,
      activeProfileId: selected.id,
      profiles: [ignored, selected]
    }
    seed(existing)
    chooseImport(legacy)

    const merged = await repository.import(existing)

    expect(merged!.profiles.slice(0, existing.profiles.length)).toEqual(existing.profiles)
    expect(merged!.profiles.map((profile) => profile.name)).toContain('Selected legacy profile')
    expect(merged!.profiles.map((profile) => profile.name)).not.toContain(
      'Inactive legacy profile'
    )
  })

  it('never writes when the selected file is invalid', async () => {
    const repository = new ProfileRepository()
    const existing = editedLibraryOf()
    seed(existing)
    const before = written.get(libraryPath)
    chooseImport({ schemaVersion: 4, id: 'invalid-profile', name: 'Invalid' })

    await expect(repository.import(existing)).rejects.toThrow()

    expect(written.get(libraryPath)).toBe(before)
    expect(operations).toEqual([])
  })

  it('refuses an import at the profile cap without opening or writing', async () => {
    const repository = new ProfileRepository()
    const source = editedLibraryOf()
    const full: ProfileLibrary = {
      ...source,
      profiles: Array.from({ length: 24 }, (_, index) => ({
        ...structuredClone(source.profiles[0]!),
        id: `profile-${index}`,
        name: `Profile ${index + 1}`
      })),
      activeProfileId: 'profile-0'
    }
    seed(full)

    await expect(repository.import(full)).rejects.toThrow('at most 24 profiles')

    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(onDisk()).toEqual(full)
    expect(operations).toEqual([])
  })

  it('exports only the selected profile as a standalone file', async () => {
    const repository = new ProfileRepository()
    const library = editedLibraryOf()
    const selected = library.profiles[0]!
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: exportedPath
    })

    await expect(repository.export(selected)).resolves.toBe(true)

    const exported = JSON.parse(written.get(exportedPath)!) as Record<string, unknown>
    expect(exported).toEqual(selected)
    expect(exported).not.toHaveProperty('profiles')
    expect(exported).not.toHaveProperty('activeProfileId')
  })
})

describe('concurrent profile writes', () => {
  it('drains every write requested before the barrier', async () => {
    const repository = new ProfileRepository()
    const library = editedLibraryOf()
    const { writeFile } = await import('node:fs/promises')
    const writeStarted = deferred()
    const allowWrite = deferred()
    vi.mocked(writeFile).mockImplementationOnce(async (path, contents) => {
      operations.push(String(path) === libraryPath ? 'write library' : 'write temporary')
      writeStarted.resolve()
      await allowWrite.promise
      written.set(String(path), String(contents))
    })

    const saving = repository.save(library)
    let drained = false
    const draining = repository.drain().then(() => {
      drained = true
    })
    await writeStarted.promise

    expect(drained).toBe(false)
    allowWrite.resolve()

    await expect(saving).resolves.toEqual(library)
    await expect(draining).resolves.toBeUndefined()
    expect(drained).toBe(true)
    expect(onDisk()).toEqual(library)
  })

  it('loads only after the preceding flush commits, then preserves it on the next save', async () => {
    const repository = new ProfileRepository()
    const oldLibrary = libraryOf()
    const flushedLibrary = editedLibraryOf()
    seed(oldLibrary)

    const { readFile, writeFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockClear()
    const writeStarted = deferred()
    const allowWrite = deferred()
    vi.mocked(writeFile).mockImplementationOnce(async (path, contents) => {
      operations.push(String(path) === libraryPath ? 'write library' : 'write temporary')
      writeStarted.resolve()
      await allowWrite.promise
      written.set(String(path), String(contents))
    })

    const flushing = repository.save(flushedLibrary)
    const reopening = repository.load()
    await writeStarted.promise

    // The reopen was requested while the close-time save was in progress. It
    // must not read the old path until the atomic rename has committed.
    expect(readFile).not.toHaveBeenCalled()
    allowWrite.resolve()

    await expect(flushing).resolves.toEqual(flushedLibrary)
    const loaded = await reopening
    expect(loaded).toEqual(flushedLibrary)
    expect(userBindingTitles(loaded)).toContain('My dashboard')

    // Model the replacement renderer changing and autosaving what it loaded.
    // A stale load would overwrite "My dashboard" at this point.
    const reopenedEdit: ProfileLibrary = {
      ...loaded,
      profiles: [{ ...loaded.profiles[0]!, name: 'Edited after reopen' }]
    }
    await repository.save(reopenedEdit)

    expect(onDisk().profiles[0]?.name).toBe('Edited after reopen')
    expect(userBindingTitles(onDisk())).toContain('My dashboard')
  })

  it('waits for a failed preceding flush, then loads the last committed library', async () => {
    const repository = new ProfileRepository()
    const committed = editedLibraryOf()
    seed(committed)

    const { readFile, writeFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockClear()
    const writeStarted = deferred()
    const failWrite = deferred()
    vi.mocked(writeFile).mockImplementationOnce(async (path) => {
      operations.push(String(path) === libraryPath ? 'write library' : 'write temporary')
      writeStarted.resolve()
      await failWrite.promise
      throw new Error('disk full')
    })

    const attempted = {
      ...committed,
      profiles: [{ ...committed.profiles[0]!, name: 'Not committed' } as MappingProfile]
    }
    const flushing = repository.save(attempted)
    const failedFlush = expect(flushing).rejects.toThrow('disk full')
    const reopening = repository.load()
    await writeStarted.promise

    expect(readFile).not.toHaveBeenCalled()
    failWrite.resolve()

    await failedFlush
    await expect(reopening).resolves.toEqual(committed)
    expect(onDisk()).toEqual(committed)
  })

  it('never interleaves two saves', async () => {
    const repository = new ProfileRepository()
    const base = libraryOf()
    const names = ['First', 'Second', 'Third']

    await Promise.all(
      names.map((name) =>
        repository.save({
          ...base,
          profiles: [{ ...base.profiles[0]!, name } as MappingProfile]
        })
      )
    )

    // An unserialised pair shows both writes before either rename.
    expect(operations).toEqual([
      'write temporary',
      'rename into place',
      'write temporary',
      'rename into place',
      'write temporary',
      'rename into place'
    ])
    expect(names).toContain(onDisk().profiles[0]?.name)
    expect(onDisk().profiles[0]?.bindings).toEqual(base.profiles[0]?.bindings)
  })

  it('keeps taking writes after one of them fails', async () => {
    const repository = new ProfileRepository()
    const base = libraryOf()

    await expect(
      repository.save({ ...base, activeProfileId: 'not a profile in this library' })
    ).rejects.toThrow('active profile')
    await expect(repository.save(base)).resolves.toMatchObject({
      activeProfileId: base.activeProfileId
    })
    expect(onDisk().activeProfileId).toBe(base.activeProfileId)
  })

  it('does not rewrite a library whose keys are stored in another order', async () => {
    const repository = new ProfileRepository()
    const library = libraryOf()
    seed(withReversedKeys(library))

    const loaded = await repository.load()

    expect(loaded).toEqual(library)
    // The old key-order-sensitive comparison rewrote the file on every launch,
    // widening the window in which a crash could truncate it.
    expect(operations).toEqual([])
  })
})
