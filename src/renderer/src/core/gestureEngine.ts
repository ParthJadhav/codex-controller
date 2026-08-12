import type { ControllerInputId, GestureKind, MappingLayer } from '@shared/contracts'
import type { RawControllerEvent } from './gamepadService'

export interface ControllerGesture {
  input: ControllerInputId
  secondaryInput?: ControllerInputId
  kind: GestureKind
  timestamp: number
  /**
   * The mapping layer in force when this press began, if the engine was told
   * how to read it.
   *
   * A gesture is not always emitted while the press is still happening: a tap
   * waits out the double-tap window, and a hold's release can arrive after a
   * momentary layer shift has already been let go. Resolving those against
   * whatever layer is current at emission time is how holding L1 and tapping
   * Cross posted Return into Codex instead of muting the microphone. Undefined
   * for gestures with no press behind them, such as stick rotation.
   */
  layer?: MappingLayer
}

export interface GestureEngineOptions {
  doubleTapMilliseconds?: number
  chordMilliseconds?: number
  longPressMilliseconds?: number
  repeatDelayMilliseconds?: number
  repeatMilliseconds?: number
}

export class GestureEngine {
  onGesture?: (gesture: ControllerGesture) => void
  shouldRecognizeChord?: (
    first: ControllerInputId,
    second: ControllerInputId,
    layer?: MappingLayer
  ) => boolean
  /**
   * Reads the layer that is active right now. Called once per press, and the
   * answer rides along on every gesture that press produces.
   */
  layerAtPress?: () => MappingLayer

  private active = new Set<ControllerInputId>()
  private pressedAt = new Map<ControllerInputId, number>()
  private pressLayers = new Map<ControllerInputId, MappingLayer>()
  /** Layer snapshots retained only for taps waiting out the double-tap window. */
  private pendingTapLayers = new Map<ControllerInputId, MappingLayer>()
  private chordParticipants = new Set<ControllerInputId>()
  private longPressFired = new Set<ControllerInputId>()
  private longPressTimers = new Map<ControllerInputId, ReturnType<typeof setTimeout>>()
  private pendingTapTimers = new Map<ControllerInputId, ReturnType<typeof setTimeout>>()
  private repeatTimers = new Map<ControllerInputId, ReturnType<typeof setTimeout>>()
  private readonly doubleTapMilliseconds: number
  private readonly chordMilliseconds: number
  private readonly longPressMilliseconds: number
  private readonly repeatDelayMilliseconds: number
  private readonly repeatMilliseconds: number

  constructor(options: GestureEngineOptions = {}) {
    this.doubleTapMilliseconds = options.doubleTapMilliseconds ?? 300
    this.chordMilliseconds = options.chordMilliseconds ?? 180
    this.longPressMilliseconds = options.longPressMilliseconds ?? 550
    this.repeatDelayMilliseconds = options.repeatDelayMilliseconds ?? 350
    this.repeatMilliseconds = options.repeatMilliseconds ?? 166
  }

  consume(event: RawControllerEvent): void {
    event.pressed ? this.beginPress(event) : this.endPress(event)
  }

  /**
   * Stick rotation is recovered from positions rather than from press events,
   * so it enters the gesture stream here instead of through `consume`. It is
   * still an ordinary gesture once emitted, and resolves against bindings the
   * same way every button does.
   */
  emitRotation(
    input: ControllerInputId,
    step: 'clockwise' | 'counterclockwise',
    timestamp = performance.now() / 1_000
  ): void {
    this.emit(
      input,
      step === 'clockwise' ? 'rotateClockwise' : 'rotateCounterClockwise',
      timestamp
    )
  }

  /**
   * Ends every press that is still down, as a release rather than as an
   * erasure.
   *
   * This is what an interruption has to use. Dropping the presses silently —
   * what `cancel` does — loses the second half of anything the press already
   * started outside this process: a `holdShortcut` posts its key-down on
   * `holdBegan` and its key-up on `holdEnded`, so a hold dropped without a
   * `holdEnded` leaves that key physically down for the rest of the session.
   * Pending taps are still cancelled: a tap that never completed is not a
   * gesture, whereas a hold in progress is a thing already happening.
   */
  reset(timestamp = performance.now() / 1_000): void {
    for (const input of this.active) {
      this.emit(input, 'buttonUp', timestamp)
      this.emit(input, 'holdEnded', timestamp)
    }
    this.clear()
  }

  /**
   * Forgets every press without emitting anything. Only safe when nothing
   * downstream can be mid-flight — see `reset` for the interruption path.
   */
  cancel(): void {
    this.clear()
  }

  private clear(): void {
    for (const timer of [
      ...this.longPressTimers.values(),
      ...this.pendingTapTimers.values(),
      ...this.repeatTimers.values()
    ]) {
      clearTimeout(timer)
    }
    this.active.clear()
    this.pressedAt.clear()
    this.pressLayers.clear()
    this.pendingTapLayers.clear()
    this.chordParticipants.clear()
    this.longPressFired.clear()
    this.longPressTimers.clear()
    this.pendingTapTimers.clear()
    this.repeatTimers.clear()
  }

  private beginPress(event: RawControllerEvent): void {
    if (this.active.has(event.input)) return
    this.active.add(event.input)
    this.pressedAt.set(event.input, event.timestamp)
    // Read before the press is announced: the layer this press belongs to is
    // the one it started in, never one that its own `holdBegan` engages.
    const layer = this.layerAtPress?.()
    if (layer === undefined) this.pressLayers.delete(event.input)
    else this.pressLayers.set(event.input, layer)
    this.emit(event.input, 'buttonDown', event.timestamp)
    this.emit(event.input, 'holdBegan', event.timestamp)

    const chordPartners = [...this.active]
      .filter((candidate) => {
        if (candidate === event.input) return false
        const timestamp = this.pressedAt.get(candidate)
        if (timestamp === undefined) return false
        if (Math.abs(event.timestamp - timestamp) * 1_000 > this.chordMilliseconds) return false
        return (
          this.shouldRecognizeChord?.(
            event.input,
            candidate,
            this.pressLayers.get(event.input)
          ) ?? true
        )
      })
      .sort()
    if (chordPartners.length > 0) this.chordParticipants.add(event.input)
    for (const partner of chordPartners) {
      this.chordParticipants.add(partner)
      this.emit(event.input, 'chord', event.timestamp, partner)
      this.cancelTimers(event.input)
      this.cancelTimers(partner)
    }
    if (chordPartners.length > 0) return

    this.longPressTimers.set(
      event.input,
      setTimeout(() => {
        if (!this.active.has(event.input)) return
        this.longPressFired.add(event.input)
        this.longPressTimers.delete(event.input)
        this.emit(event.input, 'longPress', performance.now() / 1_000)
      }, this.longPressMilliseconds)
    )

    const scheduleRepeat = (): void => {
      if (!this.active.has(event.input)) return
      this.emit(event.input, 'repeatTick', performance.now() / 1_000)
      this.repeatTimers.set(event.input, setTimeout(scheduleRepeat, this.repeatMilliseconds))
    }
    this.repeatTimers.set(event.input, setTimeout(scheduleRepeat, this.repeatDelayMilliseconds))
  }

  private endPress(event: RawControllerEvent): void {
    if (!this.active.delete(event.input)) return
    this.pressedAt.delete(event.input)
    this.cancelTimers(event.input, false)
    const pressLayer = this.pressLayers.get(event.input)
    this.emit(event.input, 'buttonUp', event.timestamp)
    this.emit(event.input, 'holdEnded', event.timestamp)
    // Rotations after release have no press behind them. A possible delayed tap
    // retains its own copy below rather than leaving this active-press map stale.
    this.pressLayers.delete(event.input)

    if (this.chordParticipants.delete(event.input) || this.longPressFired.delete(event.input)) return
    const pending = this.pendingTapTimers.get(event.input)
    if (pending) {
      clearTimeout(pending)
      this.pendingTapTimers.delete(event.input)
      this.pendingTapLayers.delete(event.input)
      this.emit(event.input, 'doubleTap', event.timestamp, undefined, pressLayer)
      return
    }
    if (pressLayer === undefined) this.pendingTapLayers.delete(event.input)
    else this.pendingTapLayers.set(event.input, pressLayer)
    this.pendingTapTimers.set(
      event.input,
      setTimeout(() => {
        this.pendingTapTimers.delete(event.input)
        const tapLayer = this.pendingTapLayers.get(event.input)
        this.pendingTapLayers.delete(event.input)
        this.emit(event.input, 'tap', event.timestamp, undefined, tapLayer)
      }, this.doubleTapMilliseconds)
    )
  }

  private cancelTimers(input: ControllerInputId, includePending = true): void {
    const longPress = this.longPressTimers.get(input)
    if (longPress) clearTimeout(longPress)
    this.longPressTimers.delete(input)
    const repeat = this.repeatTimers.get(input)
    if (repeat) clearTimeout(repeat)
    this.repeatTimers.delete(input)
    if (includePending) {
      const tap = this.pendingTapTimers.get(input)
      if (tap) clearTimeout(tap)
      this.pendingTapTimers.delete(input)
      this.pendingTapLayers.delete(input)
    }
  }

  private emit(
    input: ControllerInputId,
    kind: GestureKind,
    timestamp: number,
    secondaryInput?: ControllerInputId,
    layer = this.pressLayers.get(input)
  ): void {
    this.onGesture?.({ input, secondaryInput, kind, timestamp, layer })
  }
}
