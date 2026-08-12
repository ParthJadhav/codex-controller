import { describe, expect, it } from 'vitest'
import { mappingConflicts } from '@renderer/core/mappingResolver'
import { profileAutosaveIssue } from '@renderer/core/profileAutosave'
import {
  codexCommandNeedingSetup,
  codexCommands,
  unacknowledgedCodexCommand
} from './codexCommands'
import { createDefaultProfile } from './defaultProfile'
import type {
  ControllerInputId,
  GestureKind,
  MappedAction,
  MappingLayer,
  MappingProfile
} from './contracts'

const bindingFor = (
  profile: MappingProfile,
  input: ControllerInputId,
  gesture: GestureKind = 'tap',
  layer: MappingLayer = 'base'
) =>
  profile.bindings.find(
    (binding) =>
      binding.input === input && binding.gesture === gesture && binding.layer === layer
  )

/** Every task control has to reach Codex, which means a key Codex listens for. */
const shortcutOf = (action?: MappedAction) => action?.shortcut

describe('default controller experience', () => {
  const profile = createDefaultProfile()

  it('sends the D-pad to the arrow keys', () => {
    const arrows: Array<[ControllerInputId, number]> = [
      ['dpadUp', 0x7e],
      ['dpadDown', 0x7d],
      ['dpadLeft', 0x7b],
      ['dpadRight', 0x7c]
    ]
    for (const [input, keyCode] of arrows) {
      expect(shortcutOf(bindingFor(profile, input)?.action)).toMatchObject({
        keyCode,
        modifiers: []
      })
    }
  })

  it('keeps Cross literally Return and Circle literally Escape', () => {
    expect(shortcutOf(bindingFor(profile, 'buttonA')?.action)).toMatchObject({
      keyCode: 0x24,
      modifiers: []
    })
    expect(shortcutOf(bindingFor(profile, 'buttonB')?.action)).toMatchObject({
      keyCode: 0x35,
      modifiers: []
    })
    expect(
      profile.bindings.filter(
        (binding) => binding.input === 'buttonA' && binding.layer === 'base'
      )
    ).toHaveLength(1)
  })

  it('maps the shoulders to Tab and Shift+Tab', () => {
    expect(shortcutOf(bindingFor(profile, 'rightShoulder')?.action)).toMatchObject({
      keyCode: 0x30,
      modifiers: []
    })
    expect(shortcutOf(bindingFor(profile, 'leftShoulder')?.action)).toMatchObject({
      keyCode: 0x30,
      modifiers: ['shift']
    })
  })

  it('drives Codex commands rather than anything inside Codex Controller', () => {
    const expected: Array<[ControllerInputId, keyof typeof codexCommands]> = [
      ['buttonY', 'newTask'],
      ['buttonX', 'openProjectPicker'],
      ['rightTrigger', 'submit'],
      ['menu', 'settings']
    ]
    for (const [input, name] of expected) {
      expect(shortcutOf(bindingFor(profile, input)?.action)).toEqual(codexCommands[name].shortcut)
    }
    // Nothing may resolve to an action that only Codex Controller understands.
    const codexReady: Array<MappedAction['type']> = [
      'keyboardShortcut',
      'holdShortcut',
      'sequence',
      'primaryClick',
      'layerShift'
    ]
    expect(profile.bindings.every((binding) => codexReady.includes(binding.action.type))).toBe(true)
  })

  it('stops the active task with Escape', () => {
    expect(shortcutOf(bindingFor(profile, 'leftTrigger')?.action)).toMatchObject({
      keyCode: 0x35
    })
  })

  it('describes the touchpad click as a primary mouse click without disabling the pointer', () => {
    expect(bindingFor(profile, 'touchpad')).toMatchObject({
      action: { type: 'primaryClick', title: 'Primary mouse click' }
    })
    expect(profile.touchpadPointerEnabled).toBe(true)
  })

  it('leaves L3 rotation unmapped', () => {
    // Opening the model picker was the only model operation Codex exposes, and
    // a dial whose entire effect is to open a menu the user then drives by hand
    // is not worth a gesture. ⌃⇧M still opens it from Codex itself. The L3
    // *click* is a separate control and now toggles voice chat.
    const rotations = profile.bindings.filter(
      (binding) =>
        binding.input === 'leftStickClick' &&
        (binding.gesture === 'rotateClockwise' || binding.gesture === 'rotateCounterClockwise')
    )
    expect(rotations).toEqual([])
  })

  it('moves reasoning effort with one Codex command per direction', () => {
    expect(
      shortcutOf(bindingFor(profile, 'rightStickClick', 'rotateClockwise')?.action)
    ).toEqual(codexCommands.increaseReasoningEffort.shortcut)
    expect(
      shortcutOf(bindingFor(profile, 'rightStickClick', 'rotateCounterClockwise')?.action)
    ).toEqual(codexCommands.decreaseReasoningEffort.shortcut)
  })

  it('depends on hand-bound Codex shortcuts only where Codex ships none', () => {
    // A mapping whose key Codex has nothing bound to is silent, which reads as a
    // broken app. This pins that surface to exactly the commands Codex ships
    // unbound: the two reasoning directions and the global dictation hold.
    const unbound = profile.bindings
      .flatMap((binding) =>
        binding.action.type === 'sequence'
          ? (binding.action.sequenceSteps ?? []).map((step) => step.action)
          : [binding.action]
      )
      .filter((action) => codexCommandNeedingSetup(action.shortcut, action.codexCommandId))
    expect([...new Set(unbound.map((action) => action.codexCommandId))].sort()).toEqual([
      'composer.decreaseReasoningEffort',
      'composer.increaseReasoningEffort',
      'openControlWindow',
      'realtimeVoice.endCall',
      'realtimeVoice.toggleMicrophoneMute',
      'realtimeVoice.toggleOutputMute'
    ])
  })

  /**
   * Push-to-talk cannot be a tap: Codex dictates for as long as its hotkey is
   * physically down. The two halves must be separate bindings, because gesture
   * resolution is strict and a lone holdBegan would leave the key stuck down.
   */
  it('holds Codex’s dictation shortcut for exactly as long as Create is held', () => {
    const create = profile.bindings.filter((binding) => binding.input === 'view')
    expect(create.map((binding) => binding.gesture).sort()).toEqual(['holdBegan', 'holdEnded'])
    for (const binding of create) {
      expect(binding.action.type).toBe('holdShortcut')
      expect(binding.action.codexCommandId).toBe('composer.startDictation')
      // App-scoped, so the command is only live while Codex is focused.
      expect(binding.focusPolicy).toBe('focusIfNeeded')
    }
  })

  it('needs no setup for dictation, because Codex ships that shortcut bound', () => {
    const create = profile.bindings.find((binding) => binding.input === 'view')
    expect(codexCommands.startDictation.shipsDefault).toBe(true)
    expect(unacknowledgedCodexCommand(create!.action)).toBeNull()
  })

  it('is a valid, conflict-free profile', () => {
    expect(mappingConflicts(profile)).toEqual([])
    expect(
      profileAutosaveIssue({ schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] })
    ).toBeNull()
  })
})

describe('reporting a command Codex has nothing bound to', () => {
  const increase = codexCommands.increaseReasoningEffort

  it('flags an action posting an unbound command', () => {
    const flagged = unacknowledgedCodexCommand({ shortcut: increase.shortcut })
    expect(flagged?.commandId).toBe('composer.increaseReasoningEffort')
  })

  it('stops flagging once the user confirms they bound it', () => {
    expect(
      unacknowledgedCodexCommand({ shortcut: increase.shortcut }, [increase.commandId])
    ).toBeNull()
  })

  it('never flags a command Codex ships bound', () => {
    for (const entry of Object.values(codexCommands).filter((command) => command.shipsDefault)) {
      expect(unacknowledgedCodexCommand({ shortcut: entry.shortcut })).toBeNull()
    }
  })

  it('ignores an action that posts no shortcut at all', () => {
    expect(unacknowledgedCodexCommand({ shortcut: undefined })).toBeNull()
  })

  /**
   * The rotation the user reported: R3 announced "Increase reasoning effort"
   * while nothing changed in Codex. The default profile's R3 rotations must be
   * exactly the mappings this flags, or the fix would miss the case it exists
   * for.
   */
  it('flags both R3 rotations in the shipped default profile', () => {
    const rotations = createDefaultProfile().bindings.filter(
      (binding) =>
        binding.input === 'rightStickClick' &&
        (binding.gesture === 'rotateClockwise' || binding.gesture === 'rotateCounterClockwise')
    )
    expect(rotations).toHaveLength(2)
    for (const binding of rotations) {
      expect(unacknowledgedCodexCommand(binding.action)).not.toBeNull()
    }
  })

  it('flags nothing else in the shipped profile', () => {
    // Only the two reasoning rotations depend on a hand-bound Codex shortcut.
    const flagged = createDefaultProfile()
      .bindings.filter((binding) => unacknowledgedCodexCommand(binding.action) !== null)
      .map((binding) => binding.action.codexCommandId)
    expect([...new Set(flagged)].sort()).toEqual([
      'composer.decreaseReasoningEffort',
      'composer.increaseReasoningEffort',
      'openControlWindow',
      'realtimeVoice.endCall',
      'realtimeVoice.toggleMicrophoneMute',
      'realtimeVoice.toggleOutputMute'
    ])
  })

  /**
   * The whole point of persisting the command ID: re-recording the key in the
   * editor must not sever the link back to the Codex command it stands for.
   */
  it('still resolves the command after the key is re-recorded', () => {
    const rebound: MappedAction = {
      type: 'keyboardShortcut',
      title: 'Increase reasoning effort',
      shortcut: { keyCode: 0x03, keyDisplay: 'F', modifiers: ['command'] },
      codexCommandId: 'composer.increaseReasoningEffort'
    }
    expect(unacknowledgedCodexCommand(rebound)?.commandId).toBe(
      'composer.increaseReasoningEffort'
    )
    // And stops flagging once that command is confirmed bound.
    expect(
      unacknowledgedCodexCommand(rebound, ['composer.increaseReasoningEffort'])
    ).toBeNull()
  })
})

describe('voice chat', () => {
  const profile = createDefaultProfile()
  const voice = profile.bindings.filter((binding) => binding.layer === 'voice')

  /**
   * Codex's "Toggle voice chat" starts *and* stops a call, so one button covers
   * the lifecycle. That is why no call-state detection is needed here — which
   * matters, because a probe of a real call showed mute leaves the microphone
   * open, so mute state is not observable from outside Codex at all.
   */
  it('toggles a call from a single L3 click using a shipped shortcut', () => {
    const click = profile.bindings.find(
      (binding) => binding.input === 'leftStickClick' && binding.gesture === 'tap'
    )
    expect(click?.action.codexCommandId).toBe('composer.startVoiceMode')
    expect(codexCommands.toggleVoiceChat.shipsDefault).toBe(true)
    expect(unacknowledgedCodexCommand(click!.action)).toBeNull()
  })

  it('puts the mid-call controls on a layer held from L1', () => {
    const shift = profile.bindings.find(
      (binding) => binding.input === 'leftShoulder' && binding.gesture === 'holdBegan'
    )
    expect(shift?.action.type).toBe('layerShift')
    expect(shift?.action.targetLayer).toBe('voice')
    expect(voice.map((binding) => binding.action.codexCommandId).sort()).toEqual([
      'openControlWindow',
      'realtimeVoice.endCall',
      'realtimeVoice.toggleMicrophoneMute',
      'realtimeVoice.toggleOutputMute'
    ])
  })

  it('keeps L1 usable as Shift+Tab while also being the layer modifier', () => {
    const tap = profile.bindings.find(
      (binding) => binding.input === 'leftShoulder' && binding.gesture === 'tap'
    )
    expect(tap?.action.title).toBe('Shift Tab')
  })

  /**
   * Every mid-call command is app-scoped, so it only fires while Codex is
   * frontmost. `focusIfNeeded` is the only policy that makes them actually land;
   * `frontmostOnly` would silently do nothing from another app.
   */
  it('focuses Codex for mid-call controls, since they are app-scoped', () => {
    expect(voice).toHaveLength(4)
    for (const binding of voice) {
      expect(binding.focusPolicy).toBe('focusIfNeeded')
    }
  })

  it('mutes with a tap rather than a hold, because mute state cannot be read', () => {
    const mute = voice.find(
      (binding) => binding.action.codexCommandId === 'realtimeVoice.toggleMicrophoneMute'
    )
    // A hold would have to assume a starting state and could invert, leaving the
    // user broadcasting while believing they were muted.
    expect(mute?.gesture).toBe('tap')
    expect(mute?.action.type).toBe('keyboardShortcut')
  })

  it('does not collide with the base layer', () => {
    expect(mappingConflicts(profile)).toEqual([])
  })
})
