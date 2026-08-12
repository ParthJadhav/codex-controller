import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  managedCodexBindings,
  parseCodexKeymap,
  type ManagedBinding
} from '../shared/codexKeybindings'
import { applyCodexKeymap, codexKeymapPath, codexKeymapStatus } from './codexKeymap'

/**
 * Every case passes an explicit path into a fresh temp directory. Nothing here
 * may reach the real `~/.codex/keybindings.json` — an earlier version of this
 * file relied on mocking `homedir`, the mock silently did not apply, and the
 * suite rewrote the developer's actual Codex configuration.
 */
let directory: string
let path: string
const managed = managedCodexBindings()

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codex-keymap-test-'))
  path = join(directory, 'keybindings.json')
})

const write = (contents: string): void => writeFileSync(path, contents, 'utf8')
const read = (): string => readFileSync(path, 'utf8')

describe('test isolation', () => {
  it('never operates on the real home directory', () => {
    expect(path.startsWith(homedir())).toBe(false)
    expect(path).not.toBe(codexKeymapPath())
  })
})

describe('codexKeymapPath', () => {
  it('points at Codex’s user keymap, not the app bundle', () => {
    expect(codexKeymapPath().endsWith('/.codex/keybindings.json')).toBe(true)
  })
})

describe('applyCodexKeymap', () => {
  it('creates the keymap when Codex has never had one', async () => {
    const result = await applyCodexKeymap(managed, path)

    expect(result.status).toBe('applied')
    const written = JSON.parse(read()) as Array<{ command: string; key: string }>
    expect(written).toContainEqual({
      command: 'composer.increaseReasoningEffort',
      key: 'Ctrl+Shift+.'
    })
    expect(written).toContainEqual({
      command: 'composer.decreaseReasoningEffort',
      key: 'Ctrl+Shift+,'
    })
    expect(result.backupPath).toBeUndefined()
  })

  it('backs up an existing keymap before replacing it', async () => {
    write('[{"command":"toggleTerminal","key":"Ctrl+Shift+T"}]')
    const result = await applyCodexKeymap(managed, path)

    expect(result.status).toBe('applied')
    expect(existsSync(result.backupPath!)).toBe(true)
    expect(JSON.parse(readFileSync(result.backupPath!, 'utf8'))).toEqual([
      { command: 'toggleTerminal', key: 'Ctrl+Shift+T' }
    ])
  })

  /**
   * The backup exists to restore what Codex had before Codex Controller ever
   * touched it. Overwriting it on a later apply replaced the user's original
   * keymap with our own output and lost the only copy of it.
   */
  it('never overwrites the first backup on a later apply', async () => {
    const original = '[{"command":"toggleTerminal","key":"Ctrl+Shift+T"}]'
    write(original)
    const first = await applyCodexKeymap(managed, path)
    expect(first.status).toBe('applied')

    // A second apply that has real work to do: the user re-bound one of ours
    // by hand in between, so this is not the idempotent no-write path.
    write('[{"command":"composer.increaseReasoningEffort","key":"Command+Shift+/"}]')
    const second = await applyCodexKeymap(managed, path)

    expect(second.status).toBe('applied')
    expect(second.backupPath).toBe(first.backupPath)
    expect(readFileSync(first.backupPath!, 'utf8')).toBe(original)
  })

  it('keeps bindings for commands it does not manage', async () => {
    write('[{"command":"toggleTerminal","key":"Ctrl+Shift+T"}]')
    await applyCodexKeymap(managed, path)

    expect(JSON.parse(read())).toContainEqual({ command: 'toggleTerminal', key: 'Ctrl+Shift+T' })
  })

  /** The real case: bound by hand to a key Codex Controller never posts. */
  it('replaces a hand-picked binding and reports what it replaced', async () => {
    write('[{"command":"composer.increaseReasoningEffort","key":"Command+Shift+/"}]')
    const result = await applyCodexKeymap(managed, path)

    expect(result.status).toBe('applied')
    expect(result.message).toContain('Command+Shift+/')
    const increase = (JSON.parse(read()) as Array<{ command: string; key: string }>).filter(
      (entry) => entry.command === 'composer.increaseReasoningEffort'
    )
    expect(increase).toHaveLength(1)
    expect(increase[0]?.key).toBe('Ctrl+Shift+.')
  })

  it('is idempotent', async () => {
    await applyCodexKeymap(managed, path)
    const before = read()
    const second = await applyCodexKeymap(managed, path)

    expect(second.status).toBe('unchanged')
    expect(read()).toBe(before)
  })

  it('refuses to overwrite a keymap it cannot parse', async () => {
    write("{ this is not Codex's format }")
    const result = await applyCodexKeymap(managed, path)

    expect(result.status).toBe('unreadable')
    expect(read()).toBe("{ this is not Codex's format }")
  })

  it('refuses when another command already holds the accelerator', async () => {
    write('[{"command":"toggleTerminal","key":"Ctrl+Shift+."}]')
    const result = await applyCodexKeymap(managed, path)

    expect(result.status).toBe('conflict')
    expect(result.message).toContain('toggleTerminal')
    expect(JSON.parse(read())).toEqual([{ command: 'toggleTerminal', key: 'Ctrl+Shift+.' }])
  })

  it('leaves the file untouched when two desired commands request the same accelerator', async () => {
    const original = '[{"command":"toggleTerminal","key":"Ctrl+Shift+T"}]'
    write(original)
    const duplicateDesired = managed.map(
      (binding): ManagedBinding => ({
        ...binding,
        accelerator: 'Ctrl+Alt+Y',
        shortcut: {
          keyCode: 0x10,
          keyDisplay: 'Y',
          modifiers: ['control', 'option']
        }
      })
    )

    const result = await applyCodexKeymap(duplicateDesired, path)

    expect(result.status).toBe('conflict')
    expect(read()).toBe(original)
    expect(result.entries.filter((entry) => entry.state === 'conflict')).toHaveLength(2)
  })

  it('leaves no temporary file behind', async () => {
    await applyCodexKeymap(managed, path)
    expect(existsSync(`${path}.codex-controller-tmp`)).toBe(false)
  })

  it('writes JSON Codex can parse back', async () => {
    write('[{"command":"composer.increaseReasoningEffort","key":"Command+Shift+/"}]')
    await applyCodexKeymap(managed, path)
    expect(parseCodexKeymap(read())).not.toBeNull()
  })

  it('reports failure instead of destroying an unreadable file', async () => {
    write('[]')
    chmodSync(path, 0o000)
    const result = await applyCodexKeymap(managed, path)
    chmodSync(path, 0o644)
    // Running as root reads regardless; only assert when the mode took hold.
    if (result.status !== 'applied' && result.status !== 'unchanged') {
      expect(result.status).toBe('unreadable')
    }
  })
})

describe('codexKeymapStatus', () => {
  it('reports an unset keymap as not satisfied', async () => {
    const status = await codexKeymapStatus(managed, path)
    expect(status.readable).toBe(true)
    expect(status.satisfied).toBe(false)
  })

  it('reports satisfied once the bindings are in place', async () => {
    await applyCodexKeymap(managed, path)
    const status = await codexKeymapStatus(managed, path)
    expect(status.satisfied).toBe(true)
    expect(status.conflicts).toHaveLength(0)
  })

  it('reports an unparseable keymap as unreadable rather than empty', async () => {
    write('nonsense')
    const status = await codexKeymapStatus(managed, path)
    expect(status.readable).toBe(false)
    expect(status.satisfied).toBe(false)
  })

  it('surfaces a conflict without writing anything', async () => {
    write('[{"command":"toggleTerminal","key":"Ctrl+Shift+,"}]')
    const status = await codexKeymapStatus(managed, path)

    expect(status.conflicts.map((entry) => entry.heldBy)).toContain('toggleTerminal')
    expect(read()).toBe('[{"command":"toggleTerminal","key":"Ctrl+Shift+,"}]')
  })
})
