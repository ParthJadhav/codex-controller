import type {
  ControllerBinding,
  ControllerInputId,
  FocusPolicy,
  GestureKind,
  MappedAction,
  MappingProfile,
  ShortcutModifier
} from './contracts'
import { codexCommands, type CodexCommandName } from './codexCommands'

/**
 * An opt-in profile shaped like Codex Micro.
 *
 * Micro's surface is six Agent keys, six command keys, a four-direction analog
 * control, one dial with a click, and push-to-talk. This lays that surface over
 * a DualSense using only interfaces an outside app is allowed to use: Codex's
 * own shipped shortcuts and shortcuts the user binds themselves. Dictation is
 * Codex's own, held rather than tapped.
 *
 * The gap that cannot be closed from outside is Micro's *assignment* model.
 * Micro's Agent keys follow six slots the Codex renderer chooses and lights
 * per task; `thread1`-`thread6` select the Nth task in Codex's list instead.
 * The interaction is the same shape, the state behind it is not, and
 * `microRoles` says which is which for every control rather than letting the
 * profile imply parity it does not have.
 *
 * This profile is never installed on top of an existing one. It is added
 * alongside whatever the user already has.
 */

export const MICRO_PROFILE_NAME = 'Codex Micro companion'

/**
 * How close a role gets to the Codex Micro behaviour it stands in for.
 *
 * - `exact`    Codex ships the shortcut; the same command runs.
 * - `setup`    Codex registers the command with no default; exact once bound.
 * - `approximate` The interaction is imitated, not the Codex operation.
 */
export type MicroParity = 'exact' | 'setup' | 'approximate'

export const microParityLabels: Record<MicroParity, string> = {
  exact: 'Exact',
  setup: 'Exact after setup',
  approximate: 'Approximate'
}

/**
 * Micro's three dial modes, from the installed build's `encoderMode` schema.
 * `composer-navigation` is Micro's default; `reasoning` is the one Codex Controller
 * can actually reproduce as the same Codex operation, so it is the default here.
 */
export type MicroDialMode = 'composer-navigation' | 'reasoning' | 'conversation-scroll'

export interface MicroDialModeInfo {
  id: MicroDialMode
  title: string
  description: string
  parity: MicroParity
}

export const microDialModes: MicroDialModeInfo[] = [
  {
    id: 'reasoning',
    title: 'Reasoning effort',
    description:
      'Turn to step the composer through the current model’s reasoning efforts. Runs the same two Codex commands Micro’s dial runs, once you bind them in Codex.',
    parity: 'setup'
  },
  {
    id: 'composer-navigation',
    title: 'Composer navigation',
    description:
      'Micro’s own default. Turning moves across composer targets. Outside Codex this can only post arrow keys into whatever is focused — it cannot read Codex’s open-surface state the way Micro does.',
    parity: 'approximate'
  },
  {
    id: 'conversation-scroll',
    title: 'Conversation scroll',
    description:
      'Turn to scroll conversation content. Posts page keys rather than Codex’s own scroll routing, and this mode is specific to the installed build.',
    parity: 'approximate'
  }
]

export interface MicroRole {
  /** The Micro control this stands in for. */
  micro: string
  inputs: ControllerInputId[]
  detail: string
  parity: MicroParity
}

const id = (): string => crypto.randomUUID()

const binding = (
  input: ControllerInputId,
  action: MappedAction,
  options: Partial<{ gesture: GestureKind; focusPolicy: FocusPolicy }> = {}
): ControllerBinding => ({
  id: id(),
  input,
  gesture: options.gesture ?? 'tap',
  layer: 'base',
  action,
  focusPolicy: options.focusPolicy ?? 'focusIfNeeded',
  safety: 'normal',
  isEnabled: true
})

const key = (title: string, keyCode: number, keyDisplay: string): MappedAction => ({
  type: 'keyboardShortcut',
  title,
  shortcut: { keyCode, keyDisplay, modifiers: [] }
})

/** A Codex command held down for as long as the control is. See defaultProfile. */
const holdCommand = (name: CodexCommandName): MappedAction => {
  const entry = codexCommands[name]
  return {
    type: 'holdShortcut',
    title: entry.title,
    shortcut: entry.shortcut,
    codexCommandId: entry.commandId
  }
}

const command = (name: CodexCommandName): MappedAction => {
  const entry = codexCommands[name]
  return {
    type: 'keyboardShortcut',
    title: entry.title,
    shortcut: entry.shortcut,
    codexCommandId: entry.commandId
  }
}

const arrowUp = key('Arrow up', 0x7e, '↑')
const arrowDown = key('Arrow down', 0x7d, '↓')
const pageUp = key('Page up', 0x74, '⇞')
const pageDown = key('Page down', 0x79, '⇟')

/**
 * Micro's six Agent keys, in the order they sit on the device. The D-pad and
 * shoulders are the six discrete controls a thumb reaches without leaving the
 * sticks, which is the same argument Micro's own key row makes.
 */
const agentSlotInputs: ControllerInputId[] = [
  'dpadUp',
  'dpadRight',
  'dpadDown',
  'dpadLeft',
  'leftShoulder',
  'rightShoulder'
]

const agentSlotCommands: CodexCommandName[] = [
  'task1',
  'task2',
  'task3',
  'task4',
  'task5',
  'task6'
]

/**
 * The dial's two rotation bindings for one mode.
 *
 * Direction follows the installed Micro bridge, not intuition: it treats
 * clockwise as an ArrowUp-style movement, which in reasoning mode *decreases*
 * effort. Codex Controller's own default profile maps clockwise to increase. That
 * disagreement is deliberate — this profile matches Micro, the default profile
 * keeps the behaviour it was verified with.
 */
export const microDialBindings = (mode: MicroDialMode): ControllerBinding[] => {
  const [clockwise, counterclockwise]: [MappedAction, MappedAction] =
    mode === 'reasoning'
      ? [command('decreaseReasoningEffort'), command('increaseReasoningEffort')]
      : mode === 'composer-navigation'
        ? [arrowUp, arrowDown]
        : [pageUp, pageDown]

  return [
    binding('rightStickClick', clockwise, { gesture: 'rotateClockwise' }),
    binding('rightStickClick', counterclockwise, { gesture: 'rotateCounterClockwise' })
  ]
}

export const createMicroCompanionProfile = (
  dialMode: MicroDialMode = 'reasoning'
): MappingProfile => ({
  schemaVersion: 4,
  id: id(),
  name: MICRO_PROFILE_NAME,
  bindings: [
    // Six Agent keys → the six tasks Codex already binds ⌘1–⌘6 to.
    ...agentSlotInputs.map((input, index) =>
      binding(input, command(agentSlotCommands[index]!))
    ),

    // Six command keys, in Micro's own default keycap order:
    // APPR, REJ, FAST, SPLIT, CODEX, MIC.
    binding('buttonA', command('approve'), { focusPolicy: 'frontmostOnly' }),
    binding('buttonB', command('decline'), { focusPolicy: 'frontmostOnly' }),
    binding('buttonY', command('toggleFastMode')),
    binding('buttonX', command('forkThread')),
    binding('rightTrigger', command('submit')),
    // Micro's MIC key is push-to-talk. Held, not tapped, and handed to Codex.
    binding('view', holdCommand('startDictation'), {
      gesture: 'holdBegan',
      focusPolicy: 'focusIfNeeded'
    }),
    binding('view', holdCommand('startDictation'), {
      gesture: 'holdEnded',
      focusPolicy: 'focusIfNeeded'
    }),

    // Micro's four analog directions, with Micro's own default assignments.
    binding('leftStickUp', command('togglePlanMode')),
    binding('leftStickRight', command('navigateForward')),
    binding('leftStickDown', command('toggleSidebar')),
    binding('leftStickLeft', command('navigateBack')),

    // The dial: rotate for the selected mode, click to activate.
    ...microDialBindings(dialMode),
    binding('rightStickClick', key('Return', 0x24, '↩'), { focusPolicy: 'frontmostOnly' }),

    // Micro has one dial and so does this profile. The DualSense's second
    // circular gesture is left unmapped rather than given an invented job:
    // Codex exposes no relative model operation, and opening the picker was
    // not worth a dial.

    // Arrow navigation, for driving whatever surface is open.
    binding('rightStickUp', arrowUp, { focusPolicy: 'frontmostOnly' }),
    binding('rightStickDown', arrowDown, { focusPolicy: 'frontmostOnly' }),
    binding('rightStickLeft', key('Arrow left', 0x7b, '←'), { focusPolicy: 'frontmostOnly' }),
    binding('rightStickRight', key('Arrow right', 0x7c, '→'), { focusPolicy: 'frontmostOnly' }),

    // Micro opens its own settings from a dial long-press; the nearest
    // supported equivalent is Codex's Settings command.
    binding('menu', command('settings')),
    binding('leftTrigger', key('Stop the active task', 0x35, 'Esc'), {
      focusPolicy: 'frontmostOnly'
    }),
    binding(
      'touchpad',
      { type: 'primaryClick', title: 'Primary mouse click' },
      { focusPolicy: 'neverFocus' }
    )
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

/**
 * What each role actually achieves, for the profile's own UI. Every row is
 * labelled, including the ones that only imitate Micro, so the profile cannot
 * quietly read as full parity.
 */
export const microRoles: MicroRole[] = [
  {
    micro: 'Six Agent keys',
    inputs: agentSlotInputs,
    detail:
      'Selects tasks 1–6 through shortcuts Codex ships. Micro’s slots follow its own recent/pinned/priority assignment and light per task; these select by position instead.',
    parity: 'approximate'
  },
  {
    micro: 'Approve / Decline',
    inputs: ['buttonA', 'buttonB'],
    detail: 'Runs Codex’s approval commands on their shipped Return and Escape bindings.',
    parity: 'exact'
  },
  {
    micro: 'Fast mode / Fork task',
    inputs: ['buttonY', 'buttonX'],
    detail: 'Codex registers both commands with no default binding. Bind them once in Codex.',
    parity: 'setup'
  },
  {
    micro: 'Send',
    inputs: ['rightTrigger'],
    detail: 'Posts Return, which the composer already submits on.',
    parity: 'exact'
  },
  {
    micro: 'Push to talk',
    inputs: ['view'],
    detail:
      'Holds Codex’s own dictation shortcut for as long as the button is held, so the dictation is Codex’s rather than a separate system. Codex is brought forward first, because that command is only live while Codex is focused.',
    parity: 'exact'
  },
  {
    micro: 'Analog four directions',
    inputs: ['leftStickUp', 'leftStickRight', 'leftStickDown', 'leftStickLeft'],
    detail:
      'Micro’s own default assignments. Sidebar and back ship bound; Plan mode and forward need binding in Codex.',
    parity: 'setup'
  },
  {
    micro: 'Dial rotation',
    inputs: ['rightStickClick'],
    detail: 'Turn the right stick in a circle. Behaviour follows the selected dial mode.',
    parity: 'setup'
  },
  {
    micro: 'Dial click',
    inputs: ['rightStickClick'],
    detail: 'Posts Return to activate the focused target.',
    parity: 'approximate'
  },
  {
    micro: 'Six status lights',
    inputs: [],
    detail:
      'The DualSense has one light bar, not six key zones. Per-task status cannot be shown on the controller, and Codex exposes no external feed for it.',
    parity: 'approximate'
  }
]

/**
 * Which dial mode a profile is currently in, read back from its bindings so the
 * mode needs no stored field of its own and cannot drift out of sync with what
 * the controller will actually do. `null` when the clockwise rotation binding
 * has been edited into something that is not one of the three modes.
 */
export const microDialModeFromProfile = (profile: MappingProfile): MicroDialMode | null => {
  const clockwise = profile.bindings.find(
    (entry) => entry.input === 'rightStickClick' && entry.gesture === 'rotateClockwise'
  )
  if (!clockwise?.action.shortcut) return null
  const { keyCode, modifiers } = clockwise.action.shortcut
  if (
    keyCode === codexCommands.decreaseReasoningEffort.shortcut.keyCode &&
    sameModifiers(modifiers, codexCommands.decreaseReasoningEffort.shortcut.modifiers)
  ) {
    return 'reasoning'
  }
  if (keyCode === 0x7e && modifiers.length === 0) return 'composer-navigation'
  if (keyCode === 0x74 && modifiers.length === 0) return 'conversation-scroll'
  return null
}

/**
 * Whether two shortcuts carry the same modifiers, as a set.
 *
 * Counting them said ⌘⌥, — which posts nothing Codex listens for — was still
 * "reasoning" mode, so the dial picker showed a mode the controller would not
 * perform. Order is not significance either: the recorder emits a fixed order,
 * but an imported profile need not.
 */
const sameModifiers = (
  left: readonly ShortcutModifier[],
  right: readonly ShortcutModifier[]
): boolean => {
  const given = new Set(left)
  const wanted = new Set(right)
  return given.size === wanted.size && [...given].every((modifier) => wanted.has(modifier))
}

/**
 * Swap the dial mode, replacing only the two rotation bindings. Everything else
 * in the profile — including any editing the user has done — is left alone.
 */
export const withMicroDialMode = (
  profile: MappingProfile,
  mode: MicroDialMode
): MappingProfile => ({
  ...profile,
  bindings: [
    ...profile.bindings.filter(
      (entry) =>
        !(
          entry.input === 'rightStickClick' &&
          (entry.gesture === 'rotateClockwise' || entry.gesture === 'rotateCounterClockwise')
        )
    ),
    ...microDialBindings(mode)
  ]
})
