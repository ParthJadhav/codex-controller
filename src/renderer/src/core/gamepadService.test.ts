import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControllerSnapshot } from '@shared/contracts'
import { GamepadService, type RawControllerEvent } from './gamepadService'

const button = (value = 0, pressed = false): GamepadButton => ({
  value,
  pressed,
  touched: pressed
})

const setButton = (gamepad: Gamepad, index: number, value: GamepadButton): void => {
  const mutableButtons = gamepad.buttons as GamepadButton[]
  mutableButtons[index] = value
}

describe('gamepad service rendering', () => {
  const frames: FrameRequestCallback[] = []
  const axes = [0, 0, 0, 0]
  const gamepad = {
    axes,
    buttons: Array.from({ length: 18 }, () => button()),
    connected: true,
    id: 'DualSense Wireless Controller',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null
  } as unknown as Gamepad

  beforeEach(() => {
    frames.length = 0
    axes.fill(0)
    Object.assign(gamepad, { buttons: Array.from({ length: 18 }, () => button()) })
    vi.spyOn(performance, 'now').mockReturnValue(1)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('navigator', {
      getGamepads: vi.fn(() => [gamepad])
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('publishes changed analog input on the next display frame without a fixed throttle', () => {
    const snapshots: ControllerSnapshot[] = []
    const events: RawControllerEvent[] = []
    const service = new GamepadService(
      (snapshot) => snapshots.push(snapshot),
      (event) => events.push(event)
    )

    service.start()
    expect(snapshots).toHaveLength(1)

    axes[0] = 0.2
    frames.shift()?.(1)

    expect(events.at(-1)).toMatchObject({
      input: 'leftStickRight',
      value: 0.2,
      pressed: false
    })
    expect(snapshots).toHaveLength(2)
    expect(snapshots.at(-1)?.activeValues.leftStickRight).toBe(0.2)
    service.stop()
  })

  it('does not publish another snapshot when the sampled inputs have not changed', () => {
    const snapshots: ControllerSnapshot[] = []
    const service = new GamepadService(
      (snapshot) => snapshots.push(snapshot),
      () => undefined
    )

    service.start()
    frames.shift()?.(1)
    frames.shift()?.(2)

    expect(snapshots).toHaveLength(1)
    service.stop()
  })

  it('clears visual values and re-arms input edges after focus cleanup', () => {
    const snapshots: ControllerSnapshot[] = []
    const events: RawControllerEvent[] = []
    const service = new GamepadService(
      (snapshot) => snapshots.push(snapshot),
      (event) => events.push(event)
    )

    setButton(gamepad, 0, button(1, true))
    service.start()
    expect(events.some((event) => event.input === 'buttonA' && event.pressed)).toBe(true)

    service.reset()
    expect(snapshots.at(-1)?.activeValues).toEqual({})

    frames.shift()?.(1)
    expect(events.filter((event) => event.input === 'buttonA' && event.pressed)).toHaveLength(2)
    service.stop()
  })

  it('publishes a release snapshot after a pressed button returns to rest', () => {
    const snapshots: ControllerSnapshot[] = []
    const events: RawControllerEvent[] = []
    const service = new GamepadService(
      (snapshot) => snapshots.push(snapshot),
      (event) => events.push(event)
    )

    setButton(gamepad, 0, button(1, true))
    service.start()
    setButton(gamepad, 0, button())
    frames.shift()?.(1)

    expect(events.at(-1)).toMatchObject({
      input: 'buttonA',
      value: 0,
      pressed: false
    })
    expect(snapshots.at(-1)?.activeValues.buttonA).toBe(0)
    service.stop()
  })

  it('stops polling while the native bridge owns the controller', () => {
    const service = new GamepadService(
      () => undefined,
      () => undefined
    )
    const getGamepads = vi.mocked(navigator.getGamepads)

    service.start()
    frames.length = 0
    getGamepads.mockClear()

    service.suspend()

    // Nothing re-armed the animation frame, so the renderer's main thread stops
    // waking on every vsync for a snapshot that is discarded anyway.
    expect(service.isSuspended).toBe(true)
    expect(frames).toHaveLength(0)

    service.resume()
    expect(service.isSuspended).toBe(false)
    expect(frames).toHaveLength(1)

    frames.shift()?.(1)
    expect(getGamepads).toHaveBeenCalled()
    service.stop()
  })

  it('does not resume polling after stop', () => {
    const service = new GamepadService(
      () => undefined,
      () => undefined
    )

    service.start()
    service.suspend()
    service.stop()
    frames.length = 0
    service.resume()

    expect(frames).toHaveLength(0)
  })

  it('reports a stable capability set without rebuilding it each frame', () => {
    const snapshots: ControllerSnapshot[] = []
    const service = new GamepadService(
      (snapshot) => snapshots.push(snapshot),
      () => undefined
    )

    service.start()
    axes[0] = 0.2
    frames.shift()?.(1)

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]?.capabilities).toBe(snapshots[1]?.capabilities)
    expect(snapshots[0]?.capabilities).toContain('buttonA')
    expect(snapshots[0]?.capabilities).toContain('leftStickRight')
    expect(new Set(snapshots[0]?.capabilities).size).toBe(snapshots[0]?.capabilities.length)
    service.stop()
  })

  it('drops cached pressed state when the gamepad disconnects', () => {
    const snapshots: ControllerSnapshot[] = []
    const service = new GamepadService(
      (snapshot) => snapshots.push(snapshot),
      () => undefined
    )
    const getGamepads = vi.mocked(navigator.getGamepads)

    setButton(gamepad, 0, button(1, true))
    service.start()
    getGamepads.mockReturnValue([])
    frames.shift()?.(1)

    expect(snapshots.at(-1)).toMatchObject({
      connected: false,
      activeValues: {}
    })

    // With no gamepad exposed there is nothing to sample, so the animation
    // frame is released; `gamepadconnected` brings it back.
    setButton(gamepad, 0, button())
    getGamepads.mockReturnValue([gamepad])
    window.dispatchEvent(new Event('gamepadconnected'))
    frames.shift()?.(2)
    expect(snapshots.at(-1)?.activeValues.buttonA).toBe(0)
    service.stop()
  })

  /**
   * Regression: the drift test used to compare against the value sampled on the
   * previous frame, which was rewritten every frame whether or not anything was
   * emitted. A stick pushed at less than 0.015 per frame therefore never
   * cleared it, however far it actually travelled — the rotation tracker was
   * starved and the 3D stick sat still through the whole sweep.
   */
  it('emits while an axis is driven from rest to full deflection in 0.01 steps', () => {
    const events: RawControllerEvent[] = []
    const service = new GamepadService(
      () => undefined,
      (event) => events.push(event)
    )

    service.start()
    events.length = 0
    for (let step = 1; step <= 100; step += 1) {
      axes[0] = step / 100
      frames.shift()?.(step)
    }

    const stick = events.filter((event) => event.input === 'leftStickRight')
    expect(stick.length).toBeGreaterThan(0)
    // Two 0.01 steps clear the 0.015 drift test, so a full sweep is reported as
    // roughly fifty events rather than the one press edge it used to be.
    expect(stick.length).toBeGreaterThanOrEqual(40)
    // Within one drift step of full deflection: the last 0.01 has not cleared
    // the test yet, which is the suppression working rather than failing.
    expect(stick.at(-1)?.value).toBeGreaterThanOrEqual(0.98)
    service.stop()
  })

  /**
   * Regression: the fallback path compared both edges against one hardcoded 0.65,
   * so a stick resting on the boundary flipped pressed/released every frame.
   */
  describe('axis thresholds from the active profile', () => {
    const pressedEdges = (events: RawControllerEvent[]): boolean[] =>
      events.filter((event) => event.input === 'leftStickRight').map((event) => event.pressed)

    it('holds the press until the axis falls below the release threshold', () => {
      const events: RawControllerEvent[] = []
      const service = new GamepadService(
        () => undefined,
        (event) => events.push(event),
        { enter: 0.65, release: 0.45 }
      )

      service.start()
      events.length = 0

      axes[0] = 0.7
      frames.shift()?.(1)
      expect(pressedEdges(events).at(-1)).toBe(true)

      // Between the two thresholds: this is the band the hysteresis exists for.
      for (const value of [0.6, 0.55, 0.5, 0.46]) {
        axes[0] = value
        frames.shift()?.(2)
        expect(pressedEdges(events).at(-1)).toBe(true)
      }

      axes[0] = 0.4
      frames.shift()?.(3)
      expect(pressedEdges(events).at(-1)).toBe(false)
      service.stop()
    })

    it('takes a later profile threshold pair without being rebuilt', () => {
      const events: RawControllerEvent[] = []
      const service = new GamepadService(
        () => undefined,
        (event) => events.push(event)
      )

      service.start()
      service.setAxisThresholds({ enter: 0.3, release: 0.2 })
      events.length = 0

      axes[0] = 0.35
      frames.shift()?.(1)
      expect(pressedEdges(events).at(-1)).toBe(true)

      axes[0] = 0.25
      frames.shift()?.(2)
      expect(pressedEdges(events).at(-1)).toBe(true)

      axes[0] = 0.1
      frames.shift()?.(3)
      expect(pressedEdges(events).at(-1)).toBe(false)
      service.stop()
    })

    /** A release at or above the enter edge is chatter, not hysteresis. */
    it('refuses a release threshold above the enter threshold', () => {
      const events: RawControllerEvent[] = []
      const service = new GamepadService(
        () => undefined,
        (event) => events.push(event),
        { enter: 0.5, release: 0.9 }
      )

      service.start()
      events.length = 0

      axes[0] = 0.6
      frames.shift()?.(1)
      expect(pressedEdges(events).at(-1)).toBe(true)
      service.stop()
    })
  })

  describe('trigger thresholds from the active profile', () => {
    it('derives trigger edges from analog value instead of the browser pressed flag', () => {
      const events: RawControllerEvent[] = []
      const service = new GamepadService(
        () => undefined,
        (event) => events.push(event)
      )
      const triggerEdges = (): RawControllerEvent[] =>
        events.filter((event) => event.input === 'leftTrigger')

      service.start()
      service.setTriggerThresholds({ enter: 0.8, release: 0.4 })
      events.length = 0

      // Browser says pressed, but the configured activation edge has not been met.
      setButton(gamepad, 6, button(0.79, true))
      frames.shift()?.(1)
      expect(triggerEdges().at(-1)?.pressed).toBe(false)

      setButton(gamepad, 6, button(0.8, true))
      frames.shift()?.(2)
      expect(triggerEdges().at(-1)?.pressed).toBe(true)

      // Browser says released, but configured hysteresis keeps the press alive.
      setButton(gamepad, 6, button(0.41, false))
      frames.shift()?.(3)
      expect(triggerEdges().at(-1)?.pressed).toBe(true)

      setButton(gamepad, 6, button(0.4, false))
      frames.shift()?.(4)
      expect(triggerEdges().at(-1)?.pressed).toBe(false)
      service.stop()
    })

    it('can update trigger thresholds without rebuilding the service', () => {
      const events: RawControllerEvent[] = []
      const service = new GamepadService(
        () => undefined,
        (event) => events.push(event)
      )

      service.start()
      service.setTriggerThresholds({ enter: 0.3, release: 0.2 })
      events.length = 0
      setButton(gamepad, 7, button(0.3, false))
      frames.shift()?.(1)

      expect(events.find((event) => event.input === 'rightTrigger')?.pressed).toBe(true)
      service.stop()
    })
  })

  /**
   * Regression: `lastInput` used to be written onto the snapshot object that had
   * already been handed to the renderer, so a consumer holding one saw it
   * change under them.
   */
  it('never edits a snapshot it has already published', () => {
    const snapshots: ControllerSnapshot[] = []
    const service = new GamepadService(
      (snapshot) => snapshots.push(snapshot),
      () => undefined
    )

    setButton(gamepad, 0, button(1, true))
    service.start()
    const first = snapshots.at(-1)!
    const before = { ...first }

    setButton(gamepad, 1, button(1, true))
    frames.shift()?.(1)

    expect(snapshots.length).toBeGreaterThan(1)
    expect(snapshots.at(-1)).not.toBe(first)
    expect(first.lastInput).toBe(before.lastInput)
    expect(first.activeValues).toEqual(before.activeValues)
    service.stop()
  })

  it('releases the animation frame while no gamepad is present', () => {
    const service = new GamepadService(
      () => undefined,
      () => undefined
    )
    const getGamepads = vi.mocked(navigator.getGamepads)
    getGamepads.mockReturnValue([])

    service.start()
    frames.length = 0
    getGamepads.mockClear()

    // Nothing to poll: the renderer must not wake on every vsync just to read
    // an empty gamepad list.
    expect(frames).toHaveLength(0)

    getGamepads.mockReturnValue([gamepad])
    window.dispatchEvent(new Event('gamepadconnected'))
    expect(frames).toHaveLength(1)

    frames.shift()?.(1)
    expect(getGamepads).toHaveBeenCalled()
    service.stop()
  })
})
