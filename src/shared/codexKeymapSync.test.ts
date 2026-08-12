import { describe, expect, it } from 'vitest'
import { codexCommands } from './codexCommands'
import { createDefaultProfile } from './defaultProfile'
import { managedCodexBindingsFor, planCodexKeymap } from './codexKeybindings'
import type {
  ControllerBinding,
  KeyboardShortcut,
  MappedAction,
  MappingProfile
} from './contracts'

/**
 * The status that drives the "Set them for me" button.
 *
 * Its whole job is to stay true as the profile changes. A one-time check would
 * keep asserting "already set up" after the user re-recorded a key, enabled a
 * control, or switched profiles — which is exactly the staleness this suite
 * exists to prevent.
 */

const withBinding = (
  profile: MappingProfile,
  commandId: string,
  update: Partial<MappingProfile['bindings'][number]>
): MappingProfile => ({
  ...profile,
  bindings: profile.bindings.map((binding) =>
    binding.action.codexCommandId === commandId ? { ...binding, ...update } : binding
  )
})

const keymapMatching = (profile: MappingProfile) =>
  managedCodexBindingsFor(profile).bindings.map((entry) => ({
    command: entry.commandId,
    key: entry.accelerator
  }))

const sequenceBinding = (action: MappedAction, isEnabled = true): ControllerBinding => ({
  id: 'nested-sequence',
  input: 'buttonA',
  gesture: 'tap',
  layer: 'base',
  action,
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  isEnabled
})

const commandAction = (
  name: 'increaseReasoningEffort' | 'decreaseReasoningEffort',
  shortcut = codexCommands[name].shortcut
): MappedAction => ({
  type: 'keyboardShortcut',
  title: codexCommands[name].title,
  shortcut,
  codexCommandId: codexCommands[name].commandId
})

const nestedSequence = (...actions: MappedAction[]): MappedAction => ({
  type: 'sequence',
  title: 'Outer sequence',
  sequenceSteps: [
    {
      id: 'outer-step',
      delayMilliseconds: 0,
      action: {
        type: 'sequence',
        title: 'Inner sequence',
        sequenceSteps: actions.map((action, index) => ({
          id: `inner-${index}`,
          delayMilliseconds: 0,
          action,
          focusPolicy: 'focusIfNeeded',
          safety: 'normal'
        }))
      },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal'
    }
  ]
})

describe('what the profile needs Codex to bind', () => {
  it('is derived from the shipped profile, not a hardcoded list', () => {
    const managed = managedCodexBindingsFor(createDefaultProfile())
    expect(managed.bindings.map((entry) => entry.commandId).sort()).toEqual([
      'composer.decreaseReasoningEffort',
      'composer.increaseReasoningEffort',
      'openControlWindow',
      'realtimeVoice.endCall',
      'realtimeVoice.toggleMicrophoneMute',
      'realtimeVoice.toggleOutputMute'
    ])
  })

  it('is empty for a profile with no Codex-command mappings', () => {
    expect(managedCodexBindingsFor({ bindings: [] } as unknown as MappingProfile).bindings).toEqual(
      []
    )
    expect(managedCodexBindingsFor(null).bindings).toEqual([])
  })

  it('ignores disabled mappings, which post nothing', () => {
    const profile = withBinding(createDefaultProfile(), 'composer.increaseReasoningEffort', {
      isEnabled: false
    })
    expect(managedCodexBindingsFor(profile).bindings.map((entry) => entry.commandId)).toEqual([
      'composer.decreaseReasoningEffort',
      'openControlWindow',
      'realtimeVoice.endCall',
      'realtimeVoice.toggleMicrophoneMute',
      'realtimeVoice.toggleOutputMute'
    ])
  })

  it('never offers a command Codex already ships bound', () => {
    // The profile is full of shipped-shortcut mappings; none may appear.
    const managed = managedCodexBindingsFor(createDefaultProfile())
    for (const entry of managed.bindings) {
      const command = Object.values(codexCommands).find(
        (candidate) => candidate.commandId === entry.commandId
      )
      expect(command?.shipsDefault).toBe(false)
    }
  })

  it('follows a re-recorded key rather than the shipped one', () => {
    const profile = withBinding(createDefaultProfile(), 'composer.increaseReasoningEffort', {
      action: {
        type: 'keyboardShortcut',
        title: 'Increase reasoning effort',
        shortcut: { keyCode: 0x10, keyDisplay: 'Y', modifiers: ['control', 'option'] },
        codexCommandId: 'composer.increaseReasoningEffort'
      }
    })
    const increase = managedCodexBindingsFor(profile).bindings.find(
      (entry) => entry.commandId === 'composer.increaseReasoningEffort'
    )
    expect(increase?.accelerator).toBe('Ctrl+Alt+Y')
  })

  it('reports a key it cannot express rather than writing a wrong one', () => {
    const profile = withBinding(createDefaultProfile(), 'composer.increaseReasoningEffort', {
      action: {
        type: 'keyboardShortcut',
        title: 'Increase reasoning effort',
        // Keypad Enter has no Electron accelerator name in our table.
        shortcut: { keyCode: 0x4c, keyDisplay: '⌤', modifiers: ['control'] },
        codexCommandId: 'composer.increaseReasoningEffort'
      }
    })
    const managed = managedCodexBindingsFor(profile)
    expect(managed.bindings.map((entry) => entry.commandId)).toEqual([
      'composer.decreaseReasoningEffort',
      'openControlWindow',
      'realtimeVoice.endCall',
      'realtimeVoice.toggleMicrophoneMute',
      'realtimeVoice.toggleOutputMute'
    ])
    expect(managed.unwritable.map((entry) => entry.commandId)).toEqual([
      'composer.increaseReasoningEffort'
    ])
  })

  it('finds Codex commands recursively inside enabled sequences', () => {
    const profile = {
      bindings: [
        sequenceBinding(
          nestedSequence(
            commandAction('increaseReasoningEffort'),
            commandAction('decreaseReasoningEffort')
          )
        )
      ]
    } as unknown as MappingProfile

    expect(managedCodexBindingsFor(profile).bindings.map((entry) => entry.commandId)).toEqual([
      'composer.decreaseReasoningEffort',
      'composer.increaseReasoningEffort'
    ])
  })

  it('ignores an entire nested sequence when its controller binding is disabled', () => {
    const profile = {
      bindings: [
        sequenceBinding(nestedSequence(commandAction('increaseReasoningEffort')), false)
      ]
    } as unknown as MappingProfile

    expect(managedCodexBindingsFor(profile)).toEqual({ bindings: [], unwritable: [] })
  })

  it('deduplicates nested commands and keeps the first unwritable occurrence', () => {
    const unwritable: KeyboardShortcut = {
      keyCode: 0x4c,
      keyDisplay: '⌤',
      modifiers: ['control']
    }
    const profile = {
      bindings: [
        sequenceBinding(
          nestedSequence(
            commandAction('increaseReasoningEffort', unwritable),
            commandAction('increaseReasoningEffort')
          )
        )
      ]
    } as unknown as MappingProfile

    const managed = managedCodexBindingsFor(profile)
    expect(managed.bindings).toEqual([])
    expect(managed.unwritable.map((entry) => entry.commandId)).toEqual([
      'composer.increaseReasoningEffort'
    ])
  })
})

describe('status goes stale the moment the profile changes', () => {
  it('is satisfied when Codex matches the profile', () => {
    const profile = createDefaultProfile()
    const plan = planCodexKeymap(keymapMatching(profile), managedCodexBindingsFor(profile).bindings)
    expect(plan.changed).toBe(false)
    expect(plan.entries.every((entry) => entry.state === 'alreadySet')).toBe(true)
  })

  /** The exact complaint: change a shortcut, and the button must re-arm. */
  it('becomes unsatisfied after a shortcut is re-recorded', () => {
    const original = createDefaultProfile()
    const codexHas = keymapMatching(original)

    const edited = withBinding(original, 'composer.increaseReasoningEffort', {
      action: {
        type: 'keyboardShortcut',
        title: 'Increase reasoning effort',
        shortcut: { keyCode: 0x10, keyDisplay: 'Y', modifiers: ['control', 'option'] },
        codexCommandId: 'composer.increaseReasoningEffort'
      }
    })

    const plan = planCodexKeymap(codexHas, managedCodexBindingsFor(edited).bindings)
    expect(plan.changed).toBe(true)
    const increase = plan.entries.find(
      (entry) => entry.commandId === 'composer.increaseReasoningEffort'
    )
    expect(increase?.state).toBe('set')
    expect(increase?.previous).toBe('Ctrl+Shift+.')
    // The untouched one stays settled, so only the real drift is reported.
    expect(
      plan.entries.find((entry) => entry.commandId === 'composer.decreaseReasoningEffort')?.state
    ).toBe('alreadySet')
  })

  it('becomes unsatisfied when Codex’s own binding is changed underneath us', () => {
    const profile = createDefaultProfile()
    const codexChangedByHand = [
      { command: 'composer.increaseReasoningEffort', key: 'Command+Shift+/' },
      { command: 'composer.decreaseReasoningEffort', key: 'Ctrl+Shift+,' }
    ]
    const plan = planCodexKeymap(codexChangedByHand, managedCodexBindingsFor(profile).bindings)
    expect(plan.changed).toBe(true)
    expect(
      plan.entries.find((entry) => entry.commandId === 'composer.increaseReasoningEffort')?.state
    ).toBe('set')
  })

  it('becomes unsatisfied when Codex’s binding is removed entirely', () => {
    const profile = createDefaultProfile()
    const plan = planCodexKeymap([], managedCodexBindingsFor(profile).bindings)
    expect(plan.changed).toBe(true)
    expect(plan.entries.every((entry) => entry.state === 'set')).toBe(true)
  })

  it('reports nothing to do when every managed mapping is disabled', () => {
    let profile = createDefaultProfile()
    for (const commandId of [
      'composer.increaseReasoningEffort',
      'composer.decreaseReasoningEffort',
      'realtimeVoice.endCall',
      'realtimeVoice.toggleMicrophoneMute',
      'realtimeVoice.toggleOutputMute',
      'openControlWindow'
    ]) {
      profile = withBinding(profile, commandId, { isEnabled: false })
    }
    const managed = managedCodexBindingsFor(profile)
    expect(managed.bindings).toEqual([])
    // With nothing managed there is nothing to write and nothing to claim.
    expect(planCodexKeymap([], managed.bindings).changed).toBe(false)
  })
})
