export const controllerInputIds = [
  'buttonA',
  'buttonB',
  'buttonX',
  'buttonY',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
  'leftShoulder',
  'rightShoulder',
  'leftTrigger',
  'rightTrigger',
  'leftStickClick',
  'rightStickClick',
  'menu',
  'view',
  'share',
  'home',
  'touchpad',
  'leftStickUp',
  'leftStickDown',
  'leftStickLeft',
  'leftStickRight',
  'rightStickUp',
  'rightStickDown',
  'rightStickLeft',
  'rightStickRight'
] as const

export type ControllerInputId = (typeof controllerInputIds)[number]

/**
 * `share` is the one id nothing produces.
 *
 * It is an Xbox-era alias for the button a DualSense calls Create, which the
 * bridge and the Web Gamepad fallback both report as `view`. Offering it where
 * the user picks a control only lets them author a binding that can never fire,
 * so the editor picks from this list instead. The id stays in the contract so
 * saved profiles that still name it keep loading — `profileMigration` moves
 * them onto `view`.
 */
export const pickableControllerInputIds = controllerInputIds.filter(
  (input): input is Exclude<ControllerInputId, 'share'> => input !== 'share'
)

export const inputDisplayNames: Record<ControllerInputId, string> = {
  buttonA: 'Cross',
  buttonB: 'Circle',
  buttonX: 'Square',
  buttonY: 'Triangle',
  dpadUp: 'D-pad Up',
  dpadDown: 'D-pad Down',
  dpadLeft: 'D-pad Left',
  dpadRight: 'D-pad Right',
  leftShoulder: 'L1',
  rightShoulder: 'R1',
  leftTrigger: 'L2',
  rightTrigger: 'R2',
  leftStickClick: 'L3',
  rightStickClick: 'R3',
  menu: 'Options',
  view: 'Create',
  share: 'Share (legacy)',
  home: 'PS',
  touchpad: 'Touchpad Click',
  leftStickUp: 'Left Stick Up',
  leftStickDown: 'Left Stick Down',
  leftStickLeft: 'Left Stick Left',
  leftStickRight: 'Left Stick Right',
  rightStickUp: 'Right Stick Up',
  rightStickDown: 'Right Stick Down',
  rightStickLeft: 'Right Stick Left',
  rightStickRight: 'Right Stick Right'
}

export type MappingLayer =
  | 'base'
  | 'review'
  | 'delivery'
  | 'composer'
  | 'tasks'
  | 'general'
  | 'voice'

/**
 * Display order for the layers, base first because it is the fallback every
 * unmatched gesture resolves to.
 */
export const mappingLayerIds = [
  'base',
  'voice',
  'review',
  'delivery',
  'composer',
  'tasks',
  'general'
] as const satisfies readonly MappingLayer[]

/**
 * The one place a layer gets a human name.
 *
 * Three components used to keep their own copy and they drifted: the mapping
 * editor's copy had no `voice` entry, so voice bindings claimed to be in Base
 * and the voice option in the layer picker rendered blank. Typing it
 * `Record<MappingLayer, string>` is what makes the next added layer a compile
 * error rather than an empty label.
 */
export const mappingLayerLabels: Record<MappingLayer, string> = {
  base: 'Base',
  voice: 'Voice',
  review: 'Review',
  delivery: 'Delivery',
  composer: 'Composer',
  tasks: 'Tasks',
  general: 'General'
}

/**
 * The vocabularies below are declared as arrays with the type derived from
 * them, the way `controllerInputIds` already is.
 *
 * A bare union can only be checked at compile time, and everything crossing the
 * IPC boundary has to be checked at run time as well ([ipcRequests.ts](../main/ipcRequests.ts)).
 * Deriving the type from the array means the validator and the type cannot
 * disagree about what a gesture or an action type is — adding a member to the
 * union is adding it to the list the validator accepts.
 */
export const gestureKinds = [
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
] as const
export type GestureKind = (typeof gestureKinds)[number]

export const focusPolicies = ['frontmostOnly', 'focusIfNeeded', 'neverFocus'] as const
export type FocusPolicy = (typeof focusPolicies)[number]

export const actionSafeties = ['normal', 'consequential'] as const
export type ActionSafety = (typeof actionSafeties)[number]

export const actionTypes = [
  'none',
  'deepLink',
  'keyboardShortcut',
  'holdShortcut',
  'textInsertion',
  'openWebURL',
  'primaryClick',
  'layerShift',
  'sequence'
] as const
export type ActionType = (typeof actionTypes)[number]

export const shortcutModifiers = ['command', 'option', 'control', 'shift'] as const
export type ShortcutModifier = (typeof shortcutModifiers)[number]

export const consequentialConfirmationPolicies = [
  'repeatGesture',
  'deliberateGestureOnly'
] as const
export type ConsequentialConfirmationPolicy = (typeof consequentialConfirmationPolicies)[number]

/**
 * The one place a gesture gets a human name.
 *
 * Three components used to keep their own copy and they drifted: neither the
 * mappings list nor its search knew about the rotation gestures, so a dial
 * binding listed a raw `rotateClockwise` and searching for "rotate" found
 * nothing. Typing it `Record<GestureKind, string>` makes the next added gesture
 * a compile error rather than a raw identifier leaking into the UI.
 *
 * The wording has to work in three sentences at once: as an option in the
 * editor's "When you" picker, as the caption verb in front of an action title,
 * and as the second line of a mapping row.
 */
export const gestureLabels: Record<GestureKind, string> = {
  buttonDown: 'Press down',
  buttonUp: 'Release',
  tap: 'Tap',
  doubleTap: 'Double tap',
  longPress: 'Long press',
  holdBegan: 'Start holding',
  holdEnded: 'Stop holding',
  chord: 'Press together',
  repeatTick: 'Hold to repeat',
  rotateClockwise: 'Rotate clockwise',
  rotateCounterClockwise: 'Rotate counterclockwise'
}

export interface KeyboardShortcut {
  keyCode: number
  modifiers: ShortcutModifier[]
  keyDisplay: string
}

export interface MappedAction {
  type: ActionType
  title: string
  deepLinkURL?: string
  shortcut?: KeyboardShortcut
  /**
   * The Codex command this action means to invoke, when it means to invoke one.
   *
   * The shortcut is only the transport. Without this, re-recording the key in
   * the editor severs every link back to the command — Codex Controller can no
   * longer tell that the mapping still means "increase reasoning effort", so it
   * cannot keep Codex's binding in step or warn that the command is unbound.
   * Optional, because most mappings are plain keystrokes that mean nothing to
   * Codex in particular.
   */
  codexCommandId?: string
  text?: string
  targetLayer?: MappingLayer
  sequenceSteps?: ActionSequenceStep[]
}

export interface ActionSequenceStep {
  id: string
  delayMilliseconds: number
  action: MappedAction
  focusPolicy: FocusPolicy
  safety: ActionSafety
}

export interface ControllerBinding {
  id: string
  input: ControllerInputId
  secondaryInput?: ControllerInputId
  gesture: GestureKind
  layer: MappingLayer
  action: MappedAction
  focusPolicy: FocusPolicy
  safety: ActionSafety
  isEnabled: boolean
}

export interface MappingProfile {
  schemaVersion: 4
  id: string
  name: string
  bindings: ControllerBinding[]
  axisEnterThreshold: number
  axisReleaseThreshold: number
  triggerEnterThreshold: number
  triggerReleaseThreshold: number
  hapticsEnabled: boolean
  overlayEnabled: boolean
  touchpadPointerEnabled: boolean
  touchpadPointerSpeed: number
  consequentialConfirmationPolicy: 'repeatGesture' | 'deliberateGestureOnly'
}

export interface ProfileLibrary {
  schemaVersion: 1
  activeProfileId: string
  profiles: MappingProfile[]
}

export interface ControllerSnapshot {
  connected: boolean
  id: string
  name: string
  productCategory: string
  transport: 'USB' | 'Bluetooth' | 'Unknown'
  batteryLevel: number | null
  supportsLight: boolean
  supportsHaptics: boolean
  inputSuspended?: boolean
  touchpadPointerEnabled: boolean
  touchpadPointerStatus:
    | 'disabled'
    | 'ready'
    | 'needsAccessibility'
    | 'unavailable'
    | 'disconnected'
  touchpadPointerDiagnostics?: {
    source: 'dualsenseHID' | 'gameControllerTouchpad' | 'gameControllerFallback' | 'none'
    reports: number
    decodedReports: number
    contacts: number
    movements: number
    observedMinX?: number
    observedMaxX?: number
    observedMinY?: number
    observedMaxY?: number
  }
  capabilities: ControllerInputId[]
  activeValues: Partial<Record<ControllerInputId, number>>
  lastInput?: ControllerInputId
  lastPressed?: boolean
}

export interface AudioRouteSnapshot {
  defaultInputName: string
  defaultOutputName: string
  dualSenseInputName?: string
  dualSenseOutputName?: string
  dualSenseInputTransport?: 'USB' | 'Bluetooth' | 'Bluetooth LE' | 'Built-in' | 'Virtual' | 'Unknown'
  dualSenseOutputTransport?: 'USB' | 'Bluetooth' | 'Bluetooth LE' | 'Built-in' | 'Virtual' | 'Unknown'
  dualSenseInputChannels?: number
  dualSenseOutputChannels?: number
  dualSenseInputJackConnected?: boolean
  dualSenseOutputJackConnected?: boolean
  controllerAudioKind?: 'usbBuiltIn' | 'wiredHeadset' | 'none'
  builtInMicrophoneSupported?: boolean
  builtInSpeakerSupported?: boolean
  usbBuiltInMicrophoneAvailable?: boolean
  usbBuiltInMicrophoneReason?: string
  usbBuiltInSpeakerAvailable?: boolean
  usbBuiltInSpeakerReason?: string
  experimentalBuiltInMicrophoneAvailable?: boolean
  experimentalBuiltInMicrophoneEnabled?: boolean
  experimentalBuiltInMicrophoneReason?: string
}

/**
 * `voice` is deliberately absent. Its only input was a listening state Control
 * Deck no longer has — dictation belongs to Codex — so the renderer passed a
 * hard-coded `false` and the purple was unreachable by construction. A status
 * that can never be produced is a claim the light cannot make.
 */
export const controllerLightStatuses = [
  'idle',
  'codex',
  'actions',
  'attention',
  'success',
  'failure'
] as const
export type ControllerLightStatus = (typeof controllerLightStatuses)[number]

/** The four tones the Swift bridge's haptic engine and the overlay both know. */
export const feedbackTones = ['success', 'warning', 'failure', 'layer'] as const
export type FeedbackTone = (typeof feedbackTones)[number]

export type AgentKind = 'codex' | 'voice' | 'actions'
export type AgentActivityState =
  | 'offline'
  | 'ready'
  | 'listening'
  | 'working'
  | 'attention'
  | 'success'
  | 'failure'
  | 'paused'

export interface AgentActivity {
  kind: AgentKind
  state: AgentActivityState
  detail: string
}

export interface SystemSnapshot {
  platform: string
  appVersion: string
  nativeBridgeAvailable?: boolean
  codexRunning: boolean
  accessibilityTrusted: boolean
  microphonePermission: string
  inputMonitoringTrusted: boolean
  audio: AudioRouteSnapshot
}

export interface ActionRequest {
  bindingId?: string
  action: MappedAction
  focusPolicy: FocusPolicy
  safety: ActionSafety
  gesture?: GestureKind
  confirmationPolicy?: MappingProfile['consequentialConfirmationPolicy']
}

export interface ActionResult {
  status: 'success' | 'warning' | 'failure' | 'permissionNeeded'
  message: string
}

/**
 * `error` is a message the user is meant to read and act on. `log` is bridge
 * diagnostics — Swift framework chatter on stderr, mostly — kept on its own
 * type so the renderer can ignore it: routed to `error` it filled the app with
 * warnings nobody could do anything about.
 */
export interface NativeBridgeEvent {
  type: 'controller' | 'permission' | 'error' | 'log'
  payload: ControllerSnapshot | SystemSnapshot | { message: string }
}

export interface CodexManagedBinding {
  commandId: string
  title: string
  accelerator: string
  shortcut: KeyboardShortcut
}

export interface CodexKeybindingReport {
  commandId: string
  title: string
  accelerator: string
  state: 'set' | 'alreadySet' | 'conflict'
  previous: string | null
  heldBy?: string
}

export interface CodexKeymapStatusSnapshot {
  path: string
  readable: boolean
  entries: CodexKeybindingReport[]
  conflicts: CodexKeybindingReport[]
  satisfied: boolean
}

export interface CodexKeymapWriteSnapshot {
  status: 'applied' | 'unchanged' | 'conflict' | 'unreadable' | 'failed'
  message: string
  path: string
  backupPath?: string
  entries: CodexKeybindingReport[]
}

/**
 * The renderer owns the live profile draft, so a quit cannot durably flush it
 * from the main process alone. These channels form a correlated request/ack
 * handshake while the BrowserWindow is still alive.
 */
export const profileFlushRequestChannel = 'profiles:flush-request'
export const profileFlushResultChannel = 'profiles:flush-result'

export interface ProfileFlushResult {
  requestId: string
  success: boolean
  message?: string
}

export interface CodexControllerApi {
  profiles: {
    load: () => Promise<ProfileLibrary>
    save: (library: ProfileLibrary) => Promise<ProfileLibrary>
    /** Imports one profile into the supplied current library without replacing it. */
    import: (library: ProfileLibrary) => Promise<ProfileLibrary | null>
    /** Exports one profile, never the containing library. */
    export: (profile: MappingProfile) => Promise<boolean>
    /**
     * Runs when the main process has intercepted quit and needs the current
     * in-memory profile made durable before it tears the renderer down.
     */
    onFlushRequested: (listener: () => Promise<void>) => () => void
  }
  actions: {
    execute: (request: ActionRequest) => Promise<ActionResult>
    showOverlay: (title: string, detail: string, tone: string) => Promise<void>
  }
  /**
   * Codex's user keymap. Reading reports which of the shortcuts Codex Controller
   * posts are actually bound; applying writes the missing ones, and only ever
   * from an explicit user action.
   */
  codex: {
    keymapStatus: (managed: CodexManagedBinding[]) => Promise<CodexKeymapStatusSnapshot>
    applyKeymap: (managed: CodexManagedBinding[]) => Promise<CodexKeymapWriteSnapshot>
  }
  system: {
    snapshot: () => Promise<SystemSnapshot>
    refresh: () => Promise<SystemSnapshot>
    openSettings: (
      pane: 'accessibility' | 'inputMonitoring' | 'microphone' | 'sound'
    ) => Promise<void>
    requestMediaAccess: () => Promise<boolean>
  }
  native: {
    send: (command: string, payload?: unknown) => Promise<boolean>
    subscribe: (listener: (event: NativeBridgeEvent) => void) => () => void
  }
}
