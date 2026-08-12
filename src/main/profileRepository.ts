import { randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { z } from 'zod'
import { createDefaultProfile } from '../shared/defaultProfile'
import {
  controllerInputIds,
  type MappingProfile,
  type MappedAction,
  type ProfileLibrary
} from '../shared/contracts'
import {
  currentLibrarySchemaVersion,
  currentProfileSchemaVersion,
  migrateMappingProfile,
  migrateProfileLibrary
} from '../shared/profileMigration'
import { profileLimits } from '../shared/profileLimits'

/**
 * These schemas deliberately strip unknown keys rather than rejecting them. A
 * profile carrying a field this build has never heard of — written by a newer
 * version, or a leftover from an experiment — is still the user's mapping work,
 * and refusing the whole library over one stray key is how a rejected load turns
 * into a wiped library. Migration brings stale `schemaVersion` stamps forward
 * (see profileMigration) so the literals below only ever see the current shape.
 */
const shortcutSchema = z.object({
    keyCode: z.number().int().min(0).max(profileLimits.shortcutKeyCode),
    modifiers: z
      .array(z.enum(['command', 'option', 'control', 'shift']))
      .max(profileLimits.shortcutModifiers),
    keyDisplay: z.string().min(1).max(profileLimits.shortcutKeyDisplay)
  })

const actionSchema: z.ZodType<MappedAction> = z.lazy(() =>
  z.object({
      type: z.enum([
        'none',
        'deepLink',
        'keyboardShortcut',
        'holdShortcut',
        'textInsertion',
        'openWebURL',
        'primaryClick',
        'layerShift',
        'sequence'
      ]),
      title: z.string().min(1).max(profileLimits.actionTitle),
      deepLinkURL: z.string().max(profileLimits.url).optional(),
      shortcut: shortcutSchema.optional(),
      // Which Codex command the shortcut stands for. Persisted so the link
      // survives a restart; without it the saved profile would come back with
      // only a keystroke and no way to tell what it meant.
      codexCommandId: z.string().min(1).max(profileLimits.commandId).optional(),
      text: z.string().max(profileLimits.text).optional(),
      targetLayer: z
        .enum(['base', 'review', 'delivery', 'composer', 'tasks', 'general', 'voice'])
        .optional(),
      // A step may be any action type, `holdShortcut` included. A step carries
      // no hold gesture and gets no follow-up release, so the native
      // dispatcher runs a nested hold as a bounded press-then-release rather
      // than half a keystroke; nothing here needs to reject it.
      sequenceSteps: z
        .array(
          z.object({
              id: z.string().min(1),
              delayMilliseconds: z
                .number()
                .int()
                .min(0)
                .max(profileLimits.sequenceStepDelayMilliseconds),
              action: actionSchema,
              focusPolicy: z.enum(['frontmostOnly', 'focusIfNeeded', 'neverFocus']),
              safety: z.enum(['normal', 'consequential'])
            })
        )
        .max(profileLimits.sequenceSteps)
        .optional()
    })
    .superRefine((action, context) => {
      const seen = new Set<string>()
      for (const [index, step] of (action.sequenceSteps ?? []).entries()) {
        if (seen.has(step.id)) {
          context.addIssue({
            code: 'custom',
            path: ['sequenceSteps', index, 'id'],
            message: `Sequence step id "${step.id}" is duplicated among its siblings.`
          })
        }
        seen.add(step.id)
      }
    })
)

const bindingSchema = z.object({
    id: z.string().min(1),
    input: z.enum(controllerInputIds),
    secondaryInput: z.enum(controllerInputIds).optional(),
    gesture: z.enum([
      'buttonDown',
      'buttonUp',
      'tap',
      'doubleTap',
      'longPress',
      'holdBegan',
      'holdEnded',
      'chord',
      'repeatTick',
      'rotateClockwise',
      'rotateCounterClockwise'
    ]),
    layer: z.enum(['base', 'review', 'delivery', 'composer', 'tasks', 'general', 'voice']),
    action: actionSchema,
    focusPolicy: z.enum(['frontmostOnly', 'focusIfNeeded', 'neverFocus']),
    safety: z.enum(['normal', 'consequential']),
    isEnabled: z.boolean()
  })

const profileSchema = z
  .object({
    schemaVersion: z.literal(currentProfileSchemaVersion),
    id: z.string().min(1),
    name: z.string().min(1).max(profileLimits.profileName),
    bindings: z.array(bindingSchema).max(profileLimits.bindings),
    axisEnterThreshold: z.number().min(0).max(1),
    axisReleaseThreshold: z.number().min(0).max(1),
    triggerEnterThreshold: z.number().min(0).max(1),
    triggerReleaseThreshold: z.number().min(0).max(1),
    hapticsEnabled: z.boolean(),
    overlayEnabled: z.boolean(),
    touchpadPointerEnabled: z.boolean(),
    touchpadPointerSpeed: z.number().min(0.5).max(2.5),
    consequentialConfirmationPolicy: z.enum(['repeatGesture', 'deliberateGestureOnly'])
  })
  .superRefine((profile, context) => {
    const bindingIds = new Set<string>()
    for (const [index, binding] of profile.bindings.entries()) {
      if (bindingIds.has(binding.id)) {
        context.addIssue({
          code: 'custom',
          path: ['bindings', index, 'id'],
          message: `Binding id "${binding.id}" is duplicated in this profile.`
        })
      }
      bindingIds.add(binding.id)
    }
    if (profile.axisReleaseThreshold >= profile.axisEnterThreshold) {
      context.addIssue({
        code: 'custom',
        path: ['axisReleaseThreshold'],
        message: 'Stick release must be lower than stick activation.'
      })
    }
    if (profile.triggerReleaseThreshold >= profile.triggerEnterThreshold) {
      context.addIssue({
        code: 'custom',
        path: ['triggerReleaseThreshold'],
        message: 'Trigger release must be lower than trigger activation.'
      })
    }
  })

const profileLibrarySchema: z.ZodType<ProfileLibrary> = z
  .object({
    schemaVersion: z.literal(currentLibrarySchemaVersion),
    activeProfileId: z.string().min(1),
    profiles: z.array(profileSchema).min(1).max(profileLimits.profiles)
  })
  .superRefine((library, context) => {
    const profileIds = new Set<string>()
    for (const [index, profile] of library.profiles.entries()) {
      if (profileIds.has(profile.id)) {
        context.addIssue({
          code: 'custom',
          path: ['profiles', index, 'id'],
          message: `Profile id "${profile.id}" is duplicated in this library.`
        })
      }
      profileIds.add(profile.id)
    }
  })

const createLibrary = (): ProfileLibrary => {
  const profile = createDefaultProfile()
  return {
    schemaVersion: currentLibrarySchemaVersion,
    activeProfileId: profile.id,
    profiles: [profile]
  }
}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

/**
 * JSON with object keys in sorted order, so two encodings of the same library
 * compare equal. `JSON.stringify` preserves insertion order, which made the
 * migration check below treat a file whose keys happen to sit in a different
 * order — anything hand-edited, exported by another build, or round-tripped
 * through a tool — as changed, and rewrite the user's library on every launch.
 */
const canonicalJSON = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`)
    return `{${entries.join(',')}}`
  }
  // `undefined` has no JSON encoding; the filter above keeps it out of objects,
  // and inside an array JSON.stringify would render it as null.
  return JSON.stringify(value) ?? 'null'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * New exports are standalone profiles. Older builds exported an entire library,
 * so those files remain useful by selecting only the profile that was active
 * when the backup was made. In both cases the complete source shape is
 * validated before an imported value is allowed anywhere near persistence.
 */
const parseImportedProfile = (value: unknown): MappingProfile => {
  if (!isRecord(value) || Array.isArray(value.bindings) || !Array.isArray(value.profiles)) {
    return profileSchema.parse(migrateMappingProfile(value))
  }

  const library = profileLibrarySchema.parse(migrateProfileLibrary(value))
  const activeProfile = library.profiles.find(
    (profile) => profile.id === library.activeProfileId
  )
  if (!activeProfile) {
    throw new Error('The imported library does not contain its active profile.')
  }
  return activeProfile
}

const importedProfileName = (
  requestedName: string,
  existingProfiles: MappingProfile[]
): string => {
  const taken = new Set(existingProfiles.map((profile) => profile.name.trim().toLocaleLowerCase()))
  if (!taken.has(requestedName.trim().toLocaleLowerCase())) return requestedName

  for (let copy = 1; ; copy += 1) {
    const suffix = copy === 1 ? ' (Imported)' : ` (Imported ${copy})`
    const base = requestedName.slice(0, profileLimits.profileName - suffix.length).trimEnd()
    const candidate = `${base}${suffix}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
}

const regenerateActionStepIds = (action: MappedAction): MappedAction => {
  if (action.sequenceSteps === undefined) return { ...action }
  return {
    ...action,
    sequenceSteps: action.sequenceSteps.map((step) => ({
      ...step,
      id: randomUUID(),
      action: regenerateActionStepIds(step.action)
    }))
  }
}

const regenerateProfileIds = (
  profile: MappingProfile,
  existingProfiles: MappingProfile[]
): MappingProfile => ({
  ...profile,
  id: randomUUID(),
  name: importedProfileName(profile.name, existingProfiles),
  bindings: profile.bindings.map((binding) => ({
    ...binding,
    id: randomUUID(),
    action: regenerateActionStepIds(binding.action)
  }))
})

/**
 * Raised when `profiles.json` was readable but is not a library this app can
 * understand. The file has been set aside at `quarantinePath` and nothing was
 * written over it — the renderer reports this rather than starting from defaults,
 * because autosaving defaults on top would destroy a recoverable library.
 */
export class CorruptProfileLibraryError extends Error {
  constructor(readonly quarantinePath: string, cause: unknown) {
    super(
      `profiles.json could not be read as a profile library. The file has been kept as ${quarantinePath}.`
    )
    this.name = 'CorruptProfileLibraryError'
    this.cause = cause
  }
}

export class ProfileRepository {
  private get filePath(): string {
    return join(app.getPath('userData'), 'profiles.json')
  }

  /**
   * Releases before 0.2.0 stored profiles under the predecessor's application
   * data directory. The renamed app reads that file only when the new path is
   * empty, then writes a validated copy to the new location. The old file is
   * deliberately left untouched as a rollback backup.
   */
  private get legacyFilePath(): string {
    return join(app.getPath('appData'), 'controller-controls', 'profiles.json')
  }

  /**
   * Every write goes through this chain, so the migration rewrite in `load()`
   * and renderer autosaves can never have their temp-file-and-rename halves
   * interleaved. Rejections are absorbed here — the caller still sees them via
   * the promise it was handed — so one failed write does not poison the queue.
   */
  private writes: Promise<unknown> = Promise.resolve()

  private serialize<T>(write: () => Promise<T>): Promise<T> {
    const result = this.writes.then(write, write)
    this.writes = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /**
   * Waits for every repository write requested before this call.
   *
   * The tail absorbs individual failures so callers can use this as a shutdown
   * durability barrier without re-reporting a save error that its original
   * caller already received. Writes requested later belong to a later drain.
   */
  async drain(): Promise<void> {
    const pending = this.writes
    await pending
  }

  async load(): Promise<ProfileLibrary> {
    // `save()` appends to `writes` synchronously before its first await. Capture
    // that tail when this load is requested, then read only after every earlier
    // save has either committed or failed. This closes the macOS close/reopen
    // race where the replacement renderer could otherwise read the old file
    // while the closing renderer's flush was still writing its temporary file.
    //
    // The load itself is deliberately not appended to `writes`: first-launch
    // defaults, migrations, and quarantine all write below, and queueing the
    // whole load would make those operations wait on their own caller forever.
    await this.drain()

    let contents: string
    let migratedFromLegacyPath = false
    try {
      contents = await readFile(this.filePath, 'utf8')
    } catch (error) {
      // No file yet: a first launch, so the defaults are the honest answer.
      // Anything else — a permissions problem, a bad disk — is not a corrupt
      // library and must not be answered by writing over the path.
      if (!isMissingFileError(error)) throw error
      try {
        contents = await readFile(this.legacyFilePath, 'utf8')
        migratedFromLegacyPath = true
      } catch (legacyError) {
        if (!isMissingFileError(legacyError)) throw legacyError
        const library = createLibrary()
        await this.save(library)
        return library
      }
    }

    let migrated: ProfileLibrary
    let value: unknown
    try {
      value = JSON.parse(contents) as unknown
      migrated = profileLibrarySchema.parse(migrateProfileLibrary(value))
    } catch (error) {
      throw new CorruptProfileLibraryError(await this.quarantine(), error)
    }

    if (migratedFromLegacyPath || canonicalJSON(migrated) !== canonicalJSON(value)) {
      await this.save(migrated)
    }
    return migrated
  }

  async save(library: ProfileLibrary): Promise<ProfileLibrary> {
    const parsed = profileLibrarySchema.parse(library)
    if (!parsed.profiles.some((profile) => profile.id === parsed.activeProfileId)) {
      throw new Error('The active profile must exist in the profile library.')
    }
    const contents = `${JSON.stringify(parsed, null, 2)}\n`
    await this.serialize(async () => {
      // Written beside the real file and renamed into place: a crash or a full
      // disk mid-write leaves the previous library intact instead of a truncated
      // one, because rename onto the same filesystem is atomic.
      const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
      try {
        await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
        await rename(temporaryPath, this.filePath)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
    })
    return parsed
  }

  /**
   * Moves an unreadable `profiles.json` aside so it is still there to recover
   * from by hand, and so the path is free for a fresh library once the user asks
   * for one. Moving rather than copying is deliberate: leaving it in place would
   * fail the same way on every launch.
   */
  private async quarantine(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const quarantinePath = `${this.filePath}.corrupt-${stamp}`
    await this.serialize(() => rename(this.filePath, quarantinePath))
    return quarantinePath
  }

  async import(currentLibrary: ProfileLibrary): Promise<ProfileLibrary | null> {
    const current = profileLibrarySchema.parse(currentLibrary)
    if (!current.profiles.some((profile) => profile.id === current.activeProfileId)) {
      throw new Error('The active profile must exist in the profile library.')
    }
    if (current.profiles.length >= profileLimits.profiles) {
      throw new Error(`A profile library can contain at most ${profileLimits.profiles} profiles.`)
    }

    const result = await dialog.showOpenDialog({
      title: 'Import Codex Controller Profile',
      properties: ['openFile'],
      filters: [{ name: 'Codex Controller Profile', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const value = JSON.parse(await readFile(result.filePaths[0], 'utf8')) as unknown
    const imported = regenerateProfileIds(parseImportedProfile(value), current.profiles)
    return this.save({
      ...current,
      activeProfileId: imported.id,
      profiles: [...current.profiles, imported]
    })
  }

  async export(profile: MappingProfile): Promise<boolean> {
    const parsed = profileSchema.parse(profile)
    const result = await dialog.showSaveDialog({
      title: 'Export Codex Controller Profile',
      defaultPath: 'Codex Controller Profile.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    return true
  }
}
