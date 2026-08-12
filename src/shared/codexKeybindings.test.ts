import { describe, expect, it } from 'vitest'
import { codexCommandById, codexCommands } from './codexCommands'
import type { KeyboardShortcut } from './contracts'
import { createDefaultProfile } from './defaultProfile'
import { createMicroCompanionProfile, microDialModes } from './microProfile'
import {
  acceleratorFor,
  codexBuiltInHolder,
  codexOccupiedAccelerators,
  managedCodexBindings,
  managedCodexBindingsFor,
  parseCodexKeymap,
  planCodexKeymap,
  serializeCodexKeymap,
  type CodexKeybinding,
  type ManagedBinding
} from './codexKeybindings'

describe('acceleratorFor', () => {
  it('writes modifiers the way Codex writes them', () => {
    expect(acceleratorFor(codexCommands.increaseReasoningEffort.shortcut)).toBe('Ctrl+Shift+.')
    expect(acceleratorFor(codexCommands.decreaseReasoningEffort.shortcut)).toBe('Ctrl+Shift+,')
  })

  it('covers the keys the mapping editor can actually record', () => {
    expect(acceleratorFor({ keyCode: 0x00, keyDisplay: 'A', modifiers: ['command'] })).toBe(
      'Command+A'
    )
    expect(acceleratorFor({ keyCode: 0x7e, keyDisplay: '↑', modifiers: [] })).toBe('Up')
    expect(acceleratorFor({ keyCode: 0x63, keyDisplay: 'F3', modifiers: [] })).toBe('F3')
  })

  it('refuses a key it has no verified Electron name for', () => {
    // Guessing a name Electron rejects would write a keymap that parses fine
    // and silently never fires — the exact failure this feature removes.
    expect(acceleratorFor({ keyCode: 0x51, keyDisplay: '⌤', modifiers: [] })).toBeNull()
  })
})

describe('the shortcuts we assign', () => {
  it('avoids every accelerator this Codex build ships bound', () => {
    for (const binding of managedCodexBindings()) {
      expect(codexOccupiedAccelerators.has(binding.accelerator)).toBe(false)
    }
  })

  it('only ever offers commands Codex ships unbound', () => {
    for (const binding of managedCodexBindings()) {
      expect(codexCommandById(binding.commandId)?.shipsDefault).toBe(false)
    }
  })

  /**
   * The bug that made R3 look broken: the user bound the command by hand to a
   * key Codex Controller does not post. Deriving the written accelerator from the
   * same table the controller posts from is what stops that recurring, so the
   * two must be provably the same value.
   */
  it('writes exactly the key the controller posts', () => {
    const profile = createDefaultProfile()
    for (const binding of managedCodexBindings()) {
      const mapped = profile.bindings.find(
        (entry) => entry.action.codexCommandId === binding.commandId
      )
      expect(mapped).toBeDefined()
      expect(acceleratorFor(mapped!.action.shortcut!)).toBe(binding.accelerator)
    }
  })

  it('covers both reasoning directions', () => {
    expect(managedCodexBindings().map((entry) => entry.commandId).sort()).toEqual([
      'composer.decreaseReasoningEffort',
      'composer.increaseReasoningEffort'
    ])
  })
})

describe('planCodexKeymap', () => {
  it('writes both bindings into an empty keymap', () => {
    const plan = planCodexKeymap([])
    expect(plan.changed).toBe(true)
    expect(plan.bindings).toHaveLength(2)
    expect(plan.entries.every((entry) => entry.state === 'set')).toBe(true)
  })

  it('reports no change when the keymap already matches', () => {
    const current = managedCodexBindings().map((entry) => ({
      command: entry.commandId,
      key: entry.accelerator
    }))
    const plan = planCodexKeymap(current)
    expect(plan.changed).toBe(false)
    expect(plan.bindings).toBeNull()
    expect(plan.entries.every((entry) => entry.state === 'alreadySet')).toBe(true)
  })

  /** The user's real file: bound by hand to a key Codex Controller never sends. */
  it('replaces a hand-picked binding that does not match what we post', () => {
    const current: CodexKeybinding[] = [
      { command: 'composer.increaseReasoningEffort', key: 'Command+Shift+/' }
    ]
    const plan = planCodexKeymap(current)
    const increase = plan.entries.find(
      (entry) => entry.commandId === 'composer.increaseReasoningEffort'
    )
    expect(increase?.state).toBe('set')
    expect(increase?.previous).toBe('Command+Shift+/')
    // The stale binding must be gone, not left alongside the new one.
    const keys = plan.bindings!.filter(
      (entry) => entry.command === 'composer.increaseReasoningEffort'
    )
    expect(keys).toHaveLength(1)
    expect(keys[0]?.key).toBe('Ctrl+Shift+.')
  })

  it('preserves bindings for commands it does not manage', () => {
    const current: CodexKeybinding[] = [
      { command: 'toggleTerminal', key: 'Ctrl+Shift+T' },
      { command: 'openSkills', key: null }
    ]
    const plan = planCodexKeymap(current)
    expect(plan.bindings).toContainEqual({ command: 'toggleTerminal', key: 'Ctrl+Shift+T' })
    expect(plan.bindings).toContainEqual({ command: 'openSkills', key: null })
  })

  /**
   * Stealing an accelerator from another command would be an invisible, and
   * arguably destructive, edit to the user's own configuration.
   */
  it('refuses when another command already holds the accelerator', () => {
    const current: CodexKeybinding[] = [{ command: 'toggleTerminal', key: 'Ctrl+Shift+.' }]
    const plan = planCodexKeymap(current)
    const conflicted = plan.entries.find((entry) => entry.state === 'conflict')
    expect(conflicted?.heldBy).toBe('toggleTerminal')
    expect(plan.conflicts).toHaveLength(1)
    // The other command's binding survives untouched.
    expect(plan.bindings).not.toBeNull()
    expect(plan.bindings).toContainEqual({ command: 'toggleTerminal', key: 'Ctrl+Shift+.' })
  })

  it('does not treat our own other managed command as a conflict', () => {
    const current = managedCodexBindings().map((entry) => ({
      command: entry.commandId,
      key: entry.accelerator
    }))
    expect(planCodexKeymap(current).conflicts).toHaveLength(0)
  })

  it('refuses duplicate accelerators requested by two managed commands', () => {
    const requested: ManagedBinding[] = managedCodexBindings().map((binding) => ({
      ...binding,
      accelerator: 'Ctrl+Alt+Y',
      shortcut: { keyCode: 0x10, keyDisplay: 'Y', modifiers: ['control', 'option'] }
    }))

    const plan = planCodexKeymap([], requested)

    expect(plan.changed).toBe(false)
    expect(plan.bindings).toBeNull()
    expect(plan.conflicts).toHaveLength(2)
    expect(plan.conflicts.map((entry) => entry.heldBy).sort()).toEqual(
      requested.map((entry) => entry.commandId).sort()
    )
  })
})

/**
 * Regression: a shipped Codex binding is invisible in the user's keymap file, so a
 * plan that only reads that file reports a clean "set" for an accelerator Codex
 * was always going to answer first. The user then sees a control that does
 * something else, or nothing, with a status claiming it is set up.
 */
describe('planCodexKeymap against the accelerators Codex ships bound', () => {
  /** A mapping re-recorded onto a key Codex already uses for something. */
  const reRecordedOnto = (shortcut: KeyboardShortcut): ManagedBinding[] => [
    {
      commandId: codexCommands.increaseReasoningEffort.commandId,
      title: codexCommands.increaseReasoningEffort.title,
      accelerator: acceleratorFor(shortcut)!,
      shortcut
    }
  ]

  const commandB: KeyboardShortcut = { keyCode: 0x0b, keyDisplay: 'B', modifiers: ['command'] }
  const commandF: KeyboardShortcut = { keyCode: 0x03, keyDisplay: 'F', modifiers: ['command'] }

  it('refuses a re-recorded shortcut that collides with a shipped binding', () => {
    expect(codexOccupiedAccelerators.has('Command+B')).toBe(true)
    const plan = planCodexKeymap([], reRecordedOnto(commandB))

    expect(plan.entries[0]?.state).toBe('conflict')
    // Named, because this one is a command the shared registry describes.
    expect(plan.entries[0]?.heldBy).toBe(codexCommands.toggleSidebar.commandId)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.changed).toBe(false)
    expect(plan.bindings).toBeNull()
  })

  it('still conflicts when the shipped holder is one the registry cannot name', () => {
    expect(codexOccupiedAccelerators.has('Command+F')).toBe(true)
    const plan = planCodexKeymap([], reRecordedOnto(commandF))

    expect(plan.entries[0]?.state).toBe('conflict')
    expect(plan.entries[0]?.heldBy).toBe(codexBuiltInHolder)
  })

  it('writes nothing for the conflicted command and keeps the rest of the file', () => {
    const current: CodexKeybinding[] = [{ command: 'toggleTerminal', key: 'Ctrl+Shift+T' }]
    const plan = planCodexKeymap(current, [
      ...reRecordedOnto(commandB),
      ...managedCodexBindings().filter(
        (entry) => entry.commandId === codexCommands.decreaseReasoningEffort.commandId
      )
    ])

    expect(plan.changed).toBe(true)
    expect(plan.bindings).toContainEqual({ command: 'toggleTerminal', key: 'Ctrl+Shift+T' })
    expect(plan.bindings).toContainEqual({
      command: codexCommands.decreaseReasoningEffort.commandId,
      key: 'Ctrl+Shift+,'
    })
    expect(
      plan.bindings!.some(
        (entry) => entry.command === codexCommands.increaseReasoningEffort.commandId
      )
    ).toBe(false)
  })

  /**
   * The occupied list describes the build as shipped. Once the user moves the
   * shipped command themselves the accelerator really is free, and the file
   * they wrote is the better evidence.
   */
  it('accepts the accelerator once the user has rebound the shipped command', () => {
    const current: CodexKeybinding[] = [
      { command: codexCommands.toggleSidebar.commandId, key: 'Command+Alt+B' }
    ]
    expect(planCodexKeymap(current, reRecordedOnto(commandB)).entries[0]?.state).toBe('set')

    const unbound: CodexKeybinding[] = [
      { command: codexCommands.toggleSidebar.commandId, key: null }
    ]
    expect(planCodexKeymap(unbound, reRecordedOnto(commandB)).entries[0]?.state).toBe('set')
  })

  it('leaves every shipped profile free of conflicts', () => {
    const profiles = [
      createDefaultProfile(),
      ...microDialModes.map((mode) => createMicroCompanionProfile(mode.id))
    ]
    for (const profile of profiles) {
      const managed = managedCodexBindingsFor(profile).bindings
      const plan = planCodexKeymap([], managed)
      expect(plan.conflicts).toEqual([])
      for (const binding of managed) {
        expect(codexOccupiedAccelerators.has(binding.accelerator)).toBe(false)
      }
    }
  })

  it('leaves the default managed pair free of conflicts', () => {
    expect(planCodexKeymap([], managedCodexBindings()).conflicts).toEqual([])
  })
})

describe('parseCodexKeymap', () => {
  it('reads Codex’s documented shape', () => {
    expect(parseCodexKeymap('[{"command":"a","key":"Ctrl+A"}]')).toEqual([
      { command: 'a', key: 'Ctrl+A' }
    ])
  })

  it('accepts an explicit null key', () => {
    expect(parseCodexKeymap('[{"command":"a","key":null}]')).toEqual([{ command: 'a', key: null }])
  })

  it('treats an empty file as an empty keymap', () => {
    expect(parseCodexKeymap('   ')).toEqual([])
  })

  /** Anything unrecognised must block the write rather than be overwritten. */
  it('rejects rather than guesses', () => {
    expect(parseCodexKeymap('not json')).toBeNull()
    expect(parseCodexKeymap('{"command":"a"}')).toBeNull()
    expect(parseCodexKeymap('[{"command":1,"key":"A"}]')).toBeNull()
    expect(parseCodexKeymap('[{"command":"a","key":5}]')).toBeNull()
    expect(parseCodexKeymap('[null]')).toBeNull()
  })

  it('round-trips what it serializes', () => {
    const bindings: CodexKeybinding[] = [{ command: 'a', key: 'Ctrl+A' }, { command: 'b', key: null }]
    expect(parseCodexKeymap(serializeCodexKeymap(bindings))).toEqual(bindings)
  })
})
