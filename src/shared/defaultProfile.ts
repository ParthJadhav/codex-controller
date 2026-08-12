import type {
  ControllerBinding,
  ControllerInputId,
  FocusPolicy,
  GestureKind,
  MappedAction,
  MappingLayer,
  MappingProfile
} from './contracts'
import { codexCommands } from './codexCommands'

const id = (): string => crypto.randomUUID()

const binding = (
  input: ControllerInputId,
  action: MappedAction,
  options: Partial<{
    gesture: GestureKind
    focusPolicy: FocusPolicy
    layer: MappingLayer
  }> = {}
): ControllerBinding => ({
  id: id(),
  input,
  gesture: options.gesture ?? 'tap',
  layer: options.layer ?? 'base',
  action,
  focusPolicy: options.focusPolicy ?? 'focusIfNeeded',
  safety: 'normal',
  isEnabled: true
})

/** A plain key with no modifiers, delivered only to a frontmost Codex. */
const key = (title: string, keyCode: number, keyDisplay: string): MappedAction => ({
  type: 'keyboardShortcut',
  title,
  shortcut: { keyCode, keyDisplay, modifiers: [] }
})

/** The shortcut Codex itself has registered for one of its commands. */
const command = (name: keyof typeof codexCommands): MappedAction => {
  const entry = codexCommands[name]
  // The command ID travels with the action so re-recording the key later does
  // not sever the link back to the Codex command it stands for.
  return {
    type: 'keyboardShortcut',
    title: entry.title,
    shortcut: entry.shortcut,
    codexCommandId: entry.commandId
  }
}

/**
 * A Codex command whose key is held down for as long as the control is, rather
 * than tapped.
 *
 * Push-to-talk cannot be a tap. Codex's dictation runs for as long as its hotkey
 * is physically down, so the two halves of the keystroke have to arrive as
 * separate events — one key-down when the button goes down, one key-up when it
 * comes back up. Repeatedly re-sending the whole shortcut would read as a burst
 * of taps and would start and stop dictation over and over.
 */
const holdCommand = (name: keyof typeof codexCommands): MappedAction => {
  const entry = codexCommands[name]
  return {
    type: 'holdShortcut',
    title: entry.title,
    shortcut: entry.shortcut,
    codexCommandId: entry.commandId
  }
}

const arrowUp = key('Arrow up', 0x7e, '↑')
const arrowDown = key('Arrow down', 0x7d, '↓')

/**
 * Every control drives Codex, not Codex Controller. Where Codex ships a shortcut
 * for one of its own commands this uses that exact shortcut; commands
 * Codex registers without a default are listed in `codexCommands` and have to
 * be bound once inside Codex's Keyboard Shortcuts.
 */
export const createDefaultProfile = (): MappingProfile => ({
  schemaVersion: 4,
  id: id(),
  name: 'Codex',
  bindings: [
    binding('dpadUp', arrowUp, { focusPolicy: 'frontmostOnly' }),
    binding('dpadDown', arrowDown, { focusPolicy: 'frontmostOnly' }),
    binding('dpadLeft', key('Arrow left', 0x7b, '←'), { focusPolicy: 'frontmostOnly' }),
    binding('dpadRight', key('Arrow right', 0x7c, '→'), { focusPolicy: 'frontmostOnly' }),
    binding('buttonA', key('Return', 0x24, '↩'), { focusPolicy: 'frontmostOnly' }),
    binding('buttonB', key('Escape', 0x35, 'Esc'), { focusPolicy: 'frontmostOnly' }),
    binding('buttonX', command('openProjectPicker')),
    binding('buttonY', command('newTask')),
    binding('rightShoulder', key('Tab', 0x30, '⇥'), { focusPolicy: 'frontmostOnly' }),
    binding(
      'leftShoulder',
      {
        type: 'keyboardShortcut',
        title: 'Shift Tab',
        shortcut: { keyCode: 0x30, keyDisplay: '⇥', modifiers: ['shift'] }
      },
      { focusPolicy: 'frontmostOnly' }
    ),
    binding('rightTrigger', command('submit')),
    binding('leftTrigger', key('Stop the active task', 0x35, 'Esc'), {
      focusPolicy: 'frontmostOnly'
    }),
    /**
     * Create is push-to-talk, handed entirely to Codex.
     *
     * Two bindings, because gesture resolution is strict: the `holdBegan` half
     * posts the key down and the `holdEnded` half posts it up, so Codex sees one
     * genuine press held for exactly as long as the button is held. Re-sending
     * the whole shortcut would read as a burst of taps and start and stop
     * dictation repeatedly.
     *
     * This uses `composer.startDictation`, which Codex already ships bound to
     * `⌃⇧D` and which its own composer describes as "click to dictate or hold".
     * That command is app-scoped, so it is only live while Codex is focused —
     * hence `focusIfNeeded`, which brings Codex forward before the key goes
     * down. Codex also has an os-global `globalDictationHold` that would work
     * without stealing focus, but it ships unbound and would need setup first.
     */
    binding('view', holdCommand('startDictation'), {
      gesture: 'holdBegan',
      focusPolicy: 'focusIfNeeded'
    }),
    binding('view', holdCommand('startDictation'), {
      gesture: 'holdEnded',
      focusPolicy: 'focusIfNeeded'
    }),
    binding('menu', command('settings')),
    binding(
      'touchpad',
      { type: 'primaryClick', title: 'Primary mouse click' },
      { focusPolicy: 'neverFocus' }
    ),

    /**
     * Voice chat.
     *
     * L3 click toggles a call, because Codex's own "Toggle voice chat" starts
     * and stops with one shortcut — so a single button covers the whole
     * lifecycle without Codex Controller having to know whether a call is live.
     * That matters: a probe of a real call showed the microphone staying open
     * through mute/unmute, so call state is partly observable but mute state is
     * not, and inferring it would risk broadcasting while believing otherwise.
     *
     * Everything else lives behind holding L1, on the voice layer. L1 keeps its
     * Shift+Tab tap; holding it is a modifier, which is how the superseded
     * default already used it. Those commands are app-scoped, so they focus
     * Codex first — that is the only way they can actually land.
     */
    binding('leftStickClick', command('toggleVoiceChat')),
    binding(
      'leftShoulder',
      { type: 'layerShift', title: 'Hold Voice layer', targetLayer: 'voice' },
      { gesture: 'holdBegan' }
    ),
    binding('buttonA', command('toggleVoiceMicrophone'), { layer: 'voice' }),
    binding('buttonB', command('endVoiceChat'), { layer: 'voice' }),
    binding('buttonY', command('toggleVoiceAudio'), { layer: 'voice' }),
    binding('buttonX', command('openVoiceControlWindow'), { layer: 'voice' }),
    // L3 rotation is deliberately unmapped. It opened the model picker, which
    // was the only supported model operation Codex exposes — there is no
    // command that steps between models — and a dial whose whole effect is to
    // open a menu you then drive by hand is not worth a gesture. The picker is
    // still reachable through Codex's own ⌃⇧M.
    binding('rightStickClick', command('increaseReasoningEffort'), {
      gesture: 'rotateClockwise'
    }),
    binding('rightStickClick', command('decreaseReasoningEffort'), {
      gesture: 'rotateCounterClockwise'
    })
  ],
  axisEnterThreshold: 0.65,
  axisReleaseThreshold: 0.45,
  triggerEnterThreshold: 0.75,
  triggerReleaseThreshold: 0.55,
  hapticsEnabled: true,
  overlayEnabled: true,
  touchpadPointerEnabled: true,
  touchpadPointerSpeed: 1.25,
  consequentialConfirmationPolicy: 'repeatGesture'
})
