import {
  controllerInputIds,
  type ControllerInputId,
  type ControllerSnapshot
} from '@shared/contracts'

export interface RawControllerEvent {
  input: ControllerInputId
  value: number
  pressed: boolean
  timestamp: number
}

const buttonMap: Partial<Record<number, ControllerInputId>> = {
  0: 'buttonA',
  1: 'buttonB',
  2: 'buttonX',
  3: 'buttonY',
  4: 'leftShoulder',
  5: 'rightShoulder',
  6: 'leftTrigger',
  7: 'rightTrigger',
  8: 'view',
  9: 'menu',
  10: 'leftStickClick',
  11: 'rightStickClick',
  12: 'dpadUp',
  13: 'dpadDown',
  14: 'dpadLeft',
  15: 'dpadRight',
  16: 'home',
  17: 'touchpad'
}

// Hoisted out of the poll loop: these were rebuilt on every animation frame.
const stickInputIds = controllerInputIds.filter((value) => value.includes('Stick'))

const gamepadCapabilities: ControllerInputId[] = [
  ...new Set<ControllerInputId>([
    ...Object.values(buttonMap).filter(
      (input): input is ControllerInputId => input !== undefined
    ),
    'leftStickUp',
    'leftStickDown',
    'leftStickLeft',
    'leftStickRight',
    'rightStickUp',
    'rightStickDown',
    'rightStickLeft',
    'rightStickRight'
  ])
]

const dualSenseScore = (gamepad: Gamepad): number => {
  const id = gamepad.id.toLowerCase()
  if (id.includes('dualsense')) return 100
  if (id.includes('054c') && (id.includes('0ce6') || id.includes('0df2'))) return 90
  if (id.includes('wireless controller')) return 80
  return gamepad.mapping === 'standard' ? 10 : 1
}

/**
 * The press/release pair the Web Gamepad path reads an axis with.
 *
 * The native bridge is handed the active profile's own thresholds; this path
 * used to compare against a single hardcoded 0.65 for both edges, so a stick
 * resting on the boundary alternated pressed/released every frame. Defaults
 * match `createDefaultProfile()` so a service constructed before the profile
 * has loaded behaves the same as one that has been told.
 */
export interface AxisThresholds {
  enter: number
  release: number
}

export const defaultAxisThresholds: AxisThresholds = { enter: 0.65, release: 0.45 }
export const defaultTriggerThresholds: AxisThresholds = { enter: 0.75, release: 0.55 }

const normalizedThresholds = (thresholds: AxisThresholds): AxisThresholds => {
  const enter = Math.min(Math.max(thresholds.enter, 0), 1)
  const release = Math.min(Math.max(thresholds.release, 0), enter)
  return { enter, release }
}

const disconnectedSnapshot = (): ControllerSnapshot => ({
  connected: false,
  id: '',
  name: 'DualSense Wireless Controller',
  productCategory: 'DualSense',
  transport: 'Unknown',
  batteryLevel: null,
  supportsLight: false,
  supportsHaptics: false,
  touchpadPointerEnabled: false,
  touchpadPointerStatus: 'unavailable',
  capabilities: [],
  activeValues: {}
})

export class GamepadService {
  private animationFrame = 0
  private idleProbe = 0
  private running = false
  private suspended = false
  private activeGamepadIndex: number | null = null
  private previousPressed: Partial<Record<ControllerInputId, boolean>> = {}
  /** The last value actually delivered to `onEvent`, per input. */
  private emittedValues: Partial<Record<ControllerInputId, number>> = {}
  /** The value read this frame, whether or not it was worth emitting. */
  private currentValues: Partial<Record<ControllerInputId, number>> = {}
  private lastInput: ControllerInputId | undefined
  private lastSnapshot: ControllerSnapshot = disconnectedSnapshot()
  private axisThresholds: AxisThresholds = defaultAxisThresholds
  private triggerThresholds: AxisThresholds = defaultTriggerThresholds

  constructor(
    private readonly onSnapshot: (snapshot: ControllerSnapshot) => void,
    private readonly onEvent: (event: RawControllerEvent) => void,
    thresholds: AxisThresholds = defaultAxisThresholds
  ) {
    this.setAxisThresholds(thresholds)
  }

  /**
   * Adopts the active profile's axis thresholds. Called whenever the profile
   * changes, so the fallback path tracks the same numbers the native bridge is
   * configured with rather than a constant nobody can edit.
   */
  setAxisThresholds(thresholds: AxisThresholds): void {
    this.axisThresholds = normalizedThresholds(thresholds)
  }

  /** Adopts the profile's independent analog trigger press/release edges. */
  setTriggerThresholds(thresholds: AxisThresholds): void {
    this.triggerThresholds = normalizedThresholds(thresholds)
  }

  start(): void {
    window.addEventListener('gamepadconnected', this.handleConnection)
    window.addEventListener('gamepaddisconnected', this.handleConnection)
    this.running = true
    if (!this.suspended) this.poll()
  }

  stop(): void {
    this.running = false
    this.cancelScheduledWork()
    window.removeEventListener('gamepadconnected', this.handleConnection)
    window.removeEventListener('gamepaddisconnected', this.handleConnection)
    this.clearInputHistory()
  }

  /**
   * Stop polling while the native bridge owns the controller. The Web Gamepad
   * snapshot is discarded in that mode anyway, so polling it every animation
   * frame is pure waste — and it keeps the renderer's main thread awake on
   * every vsync, which prevents the process from ever going idle.
   */
  suspend(): void {
    if (this.suspended) return
    this.suspended = true
    this.cancelScheduledWork()
    this.clearInputHistory()
  }

  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    if (this.running) this.schedulePoll()
  }

  get isSuspended(): boolean {
    return this.suspended
  }

  private schedulePoll(): void {
    if (!this.running || this.suspended) return
    this.animationFrame = requestAnimationFrame(this.poll)
  }

  /**
   * When no gamepad is exposed at all there is nothing to sample, so drop off
   * the animation frame entirely. `gamepadconnected` is the API's own signal
   * that one appeared; the slow probe is only a safety net in case the event is
   * missed, and costs 1 wake-up per second instead of one per vsync.
   */
  private scheduleIdleProbe(): void {
    if (!this.running || this.suspended || this.idleProbe !== 0) return
    this.idleProbe = window.setTimeout(() => {
      this.idleProbe = 0
      this.poll()
    }, 1_000)
  }

  private cancelScheduledWork(): void {
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = 0
    if (this.idleProbe !== 0) window.clearTimeout(this.idleProbe)
    this.idleProbe = 0
  }

  reset(): void {
    this.clearInputHistory()
    if (!this.lastSnapshot.connected) return
    this.lastSnapshot = {
      ...this.lastSnapshot,
      activeValues: {},
      lastInput: undefined,
      lastPressed: undefined
    }
    this.publish()
  }

  /**
   * Hands out a copy rather than the object this service keeps editing.
   *
   * `lastSnapshot` is retained to answer "has anything changed", and the
   * per-event `lastInput` used to be written straight onto it — which rewrote a
   * snapshot the renderer was already holding, so a consumer that kept one
   * saw its `lastInput` change under it.
   */
  private publish(): void {
    this.onSnapshot({ ...this.lastSnapshot })
  }

  pulse(intensity = 0.35, duration = 90): void {
    if (this.activeGamepadIndex === null) return
    const gamepad = navigator.getGamepads()[this.activeGamepadIndex]
    const actuator = gamepad?.vibrationActuator
    if (!actuator || !('playEffect' in actuator)) return
    void actuator.playEffect('dual-rumble', {
      duration,
      startDelay: 0,
      strongMagnitude: intensity,
      weakMagnitude: intensity * 0.7
    })
  }

  private readonly handleConnection = (): void => {
    this.activeGamepadIndex = null
    // Resume immediately rather than waiting for the slow probe.
    if (this.animationFrame === 0) {
      this.cancelScheduledWork()
      this.schedulePoll()
    }
  }

  private readonly poll = (): void => {
    // This frame has fired, so the handle is spent. Clearing it is what lets
    // `handleConnection` tell "a poll is already queued" from "parked".
    this.animationFrame = 0
    if (!this.running || this.suspended) return

    // Single scan instead of Array.from + filter + sort: this runs on every
    // animation frame, so the intermediate arrays were pure garbage.
    let selected: Gamepad | null = null
    let selectedScore = -1
    const gamepads = navigator.getGamepads()
    for (let index = 0; index < gamepads.length; index += 1) {
      const candidate = gamepads[index]
      if (!candidate || !candidate.connected) continue
      const score = dualSenseScore(candidate)
      if (score > selectedScore) {
        selectedScore = score
        selected = candidate
      }
    }
    if (!selected) {
      if (this.lastSnapshot.connected) {
        this.clearInputHistory()
        this.lastSnapshot = disconnectedSnapshot()
        this.publish()
      }
      this.activeGamepadIndex = null
      this.scheduleIdleProbe()
      return
    }

    this.activeGamepadIndex = selected.index
    const id = selected.id
    if (this.lastSnapshot.connected && this.lastSnapshot.id !== id) {
      this.clearInputHistory()
    }
    let inputChanged = false
    const buttons = selected.buttons
    for (let index = 0; index < buttons.length; index += 1) {
      const input = buttonMap[index]
      if (!input) continue
      const button = buttons[index]!
      inputChanged =
        (input === 'leftTrigger' || input === 'rightTrigger'
          ? this.updateTrigger(input, button.value)
          : this.emitChange(input, button.value, button.pressed)) || inputChanged
    }

    const [leftX = 0, leftY = 0, rightX = 0, rightY = 0] = selected.axes
    inputChanged = this.updateAxis('leftStickLeft', Math.max(0, -leftX)) || inputChanged
    inputChanged = this.updateAxis('leftStickRight', Math.max(0, leftX)) || inputChanged
    inputChanged = this.updateAxis('leftStickUp', Math.max(0, -leftY)) || inputChanged
    inputChanged = this.updateAxis('leftStickDown', Math.max(0, leftY)) || inputChanged
    inputChanged = this.updateAxis('rightStickLeft', Math.max(0, -rightX)) || inputChanged
    inputChanged = this.updateAxis('rightStickRight', Math.max(0, rightX)) || inputChanged
    inputChanged = this.updateAxis('rightStickUp', Math.max(0, -rightY)) || inputChanged
    inputChanged = this.updateAxis('rightStickDown', Math.max(0, rightY)) || inputChanged

    // Only materialise a snapshot when one is actually going to be delivered.
    // `emitChange` has already recorded every value read this frame.
    if (!this.lastSnapshot.connected || id !== this.lastSnapshot.id || inputChanged) {
      const activeValues: Partial<Record<ControllerInputId, number>> = {}
      for (let index = 0; index < buttons.length; index += 1) {
        const input = buttonMap[index]
        if (input) activeValues[input] = buttons[index]!.value
      }
      for (const input of stickInputIds) {
        const value = this.currentValues[input]
        if (value !== undefined) activeValues[input] = value
      }
      this.lastSnapshot = {
        connected: true,
        id,
        name: id.toLowerCase().includes('dualsense') ? 'DualSense Wireless Controller' : id,
        productCategory: selectedScore >= 80 ? 'DualSense' : 'Extended Gamepad',
        transport: id.toLowerCase().includes('bluetooth') ? 'Bluetooth' : 'Unknown',
        batteryLevel: null,
        supportsLight: false,
        supportsHaptics: Boolean(selected.vibrationActuator),
        touchpadPointerEnabled: false,
        touchpadPointerStatus: 'unavailable',
        capabilities: gamepadCapabilities as ControllerInputId[],
        activeValues,
        lastInput: this.lastInput
      }
      this.publish()
    }
    this.schedulePoll()
  }

  /**
   * Hysteresis, not a single boundary: a stick already counted as pressed stays
   * pressed until it falls back past the *release* threshold. With one number
   * for both edges, a stick held right on it flipped every frame.
   */
  private updateAxis(input: ControllerInputId, value: number): boolean {
    return this.updateThresholdInput(input, value, this.axisThresholds)
  }

  private updateTrigger(input: ControllerInputId, value: number): boolean {
    return this.updateThresholdInput(input, value, this.triggerThresholds)
  }

  private updateThresholdInput(
    input: ControllerInputId,
    value: number,
    thresholds: AxisThresholds
  ): boolean {
    const wasPressed = this.previousPressed[input] ?? false
    const pressed = wasPressed
      ? value > thresholds.release
      : value >= thresholds.enter
    return this.emitChange(input, value, pressed)
  }

  private emitChange(input: ControllerInputId, value: number, pressed: boolean): boolean {
    const previousPressed = this.previousPressed[input] ?? false
    // Compared against the last value that was *emitted*, never against the
    // last one sampled. Re-baselining every frame meant a stick pushed at less
    // than 0.015 per frame never cleared the drift test, however far it
    // travelled — which starved rotation detection and froze the 3D stick.
    const emittedValue = this.emittedValues[input] ?? 0
    this.currentValues[input] = value
    if (pressed === previousPressed && Math.abs(value - emittedValue) < 0.015) return false
    this.previousPressed[input] = pressed
    this.emittedValues[input] = value
    this.lastInput = input
    this.onEvent({
      input,
      value,
      pressed,
      timestamp: performance.now() / 1_000
    })
    return true
  }

  private clearInputHistory(): void {
    this.previousPressed = {}
    this.emittedValues = {}
    this.currentValues = {}
    this.lastInput = undefined
  }
}
