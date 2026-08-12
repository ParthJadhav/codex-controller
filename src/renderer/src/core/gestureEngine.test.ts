import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GestureEngine, type ControllerGesture } from './gestureEngine'

const event = (
  input: 'buttonA' | 'buttonB',
  pressed: boolean,
  timestamp: number
) => ({
  input,
  value: pressed ? 1 : 0,
  pressed,
  timestamp
})

describe('gesture engine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('emits a tap only after the double-tap window closes', () => {
    const output: ControllerGesture[] = []
    const engine = new GestureEngine({ doubleTapMilliseconds: 300 })
    engine.onGesture = (gesture) => output.push(gesture)
    engine.consume(event('buttonA', true, 1))
    engine.consume(event('buttonA', false, 1.05))
    expect(output.map((value) => value.kind)).not.toContain('tap')
    vi.advanceTimersByTime(301)
    expect(output.map((value) => value.kind)).toContain('tap')
  })

  it('turns the second tap into one double-tap gesture', () => {
    const output: ControllerGesture[] = []
    const engine = new GestureEngine({ doubleTapMilliseconds: 300 })
    engine.onGesture = (gesture) => output.push(gesture)
    engine.consume(event('buttonA', true, 1))
    engine.consume(event('buttonA', false, 1.04))
    vi.advanceTimersByTime(80)
    engine.consume(event('buttonA', true, 1.12))
    engine.consume(event('buttonA', false, 1.16))
    expect(output.filter((value) => value.kind === 'doubleTap')).toHaveLength(1)
    vi.advanceTimersByTime(400)
    expect(output.filter((value) => value.kind === 'tap')).toHaveLength(0)
  })

  it('recognizes a configured chord without leaking long-press or repeat timers', () => {
    const output: ControllerGesture[] = []
    const engine = new GestureEngine({
      chordMilliseconds: 180,
      longPressMilliseconds: 500,
      repeatDelayMilliseconds: 300
    })
    engine.shouldRecognizeChord = () => true
    engine.onGesture = (gesture) => output.push(gesture)
    engine.consume(event('buttonA', true, 1))
    engine.consume(event('buttonB', true, 1.1))
    vi.advanceTimersByTime(800)
    expect(output.filter((value) => value.kind === 'chord')).toHaveLength(1)
    expect(output.filter((value) => value.kind === 'longPress')).toHaveLength(0)
    expect(output.filter((value) => value.kind === 'repeatTick')).toHaveLength(0)
  })

  it('emits long press and suppresses tap on release', () => {
    const output: ControllerGesture[] = []
    const engine = new GestureEngine({
      longPressMilliseconds: 500,
      repeatDelayMilliseconds: 900
    })
    engine.onGesture = (gesture) => output.push(gesture)
    engine.consume(event('buttonA', true, 1))
    vi.advanceTimersByTime(510)
    engine.consume(event('buttonA', false, 1.51))
    vi.advanceTimersByTime(400)
    expect(output.filter((value) => value.kind === 'longPress')).toHaveLength(1)
    expect(output.filter((value) => value.kind === 'tap')).toHaveLength(0)
  })

  it('cancels an interrupted press without leaking release, tap, or repeat gestures', () => {
    const output: ControllerGesture[] = []
    const engine = new GestureEngine({
      doubleTapMilliseconds: 100,
      longPressMilliseconds: 150,
      repeatDelayMilliseconds: 120
    })
    engine.onGesture = (gesture) => output.push(gesture)

    engine.consume(event('buttonA', true, 1))
    engine.cancel()
    vi.advanceTimersByTime(500)
    engine.consume(event('buttonA', false, 1.5))

    expect(output.map((gesture) => gesture.kind)).toEqual(['buttonDown', 'holdBegan'])
  })

  /**
   * The interruption path, as opposed to `cancel`. A `holdShortcut` has already
   * posted its key-down by the time the window blurs, so the release has to be
   * emitted or that key stays down for the rest of the session.
   */
  describe('reset', () => {
    it('releases every held press instead of dropping it', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ longPressMilliseconds: 900 })
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.consume(event('buttonB', true, 1.01))
      output.length = 0
      engine.reset(2)

      expect(output.map((gesture) => `${gesture.input}:${gesture.kind}`)).toEqual([
        'buttonA:buttonUp',
        'buttonA:holdEnded',
        'buttonB:buttonUp',
        'buttonB:holdEnded'
      ])
      expect(output.every((gesture) => gesture.timestamp === 2)).toBe(true)
    })

    it('leaves nothing behind to fire afterwards', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({
        doubleTapMilliseconds: 100,
        longPressMilliseconds: 150,
        repeatDelayMilliseconds: 120
      })
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.reset(1.2)
      output.length = 0
      vi.advanceTimersByTime(500)
      // The physical release arriving after the reset is not a second gesture.
      engine.consume(event('buttonA', false, 1.5))

      expect(output).toEqual([])
    })
  })

  /**
   * A gesture is not always emitted while its press is still happening: a tap
   * waits out the double-tap window, and a hold's release can arrive after a
   * momentary layer shift has been let go. Both have to resolve against the
   * layer the press began in.
   */
  describe('the layer a press began in', () => {
    it('rides along on every gesture that press produces', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ doubleTapMilliseconds: 300 })
      let layer = 'voice'
      engine.layerAtPress = () => layer as 'base' | 'voice'
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      // The shift is released before the tap's window closes.
      layer = 'base'
      engine.consume(event('buttonA', false, 1.05))
      vi.advanceTimersByTime(301)

      const tap = output.find((gesture) => gesture.kind === 'tap')
      expect(tap?.layer).toBe('voice')
      expect(output.every((gesture) => gesture.layer === 'voice')).toBe(true)
    })

    it('is read before the press is announced, so a press cannot ride its own shift', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine()
      let layer: 'base' | 'voice' = 'base'
      engine.layerAtPress = () => layer
      // A layer-shift binding is engaged by this very press's holdBegan.
      engine.onGesture = (gesture) => {
        output.push(gesture)
        if (gesture.kind === 'holdBegan') layer = 'voice'
      }

      engine.consume(event('buttonA', true, 1))

      expect(output.map((gesture) => gesture.layer)).toEqual(['base', 'base'])
    })

    it('leaves the layer undefined when nothing told it how to read one', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine()
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.emitRotation('leftStickClick', 'clockwise', 2)

      expect(output.every((gesture) => gesture.layer === undefined)).toBe(true)
    })
  })

  /**
   * A held control is what drives the reasoning-effort dial and the picker, so
   * the first tick has to wait long enough that an ordinary tap never produces
   * one, and the ticks after it have to arrive fast enough to feel like a key
   * repeat.
   */
  describe('repeat ticks under a hold', () => {
    it('waits the repeat delay before the first tick, then repeats on the shorter cadence', () => {
      const output: ControllerGesture[] = []
      // The shipped defaults: 350 ms before the first tick, 166 ms between.
      const engine = new GestureEngine()
      engine.onGesture = (gesture) => output.push(gesture)
      const ticks = (): number => output.filter((gesture) => gesture.kind === 'repeatTick').length

      engine.consume(event('buttonA', true, 1))
      vi.advanceTimersByTime(349)
      expect(ticks()).toBe(0)

      vi.advanceTimersByTime(1)
      expect(ticks()).toBe(1)

      vi.advanceTimersByTime(165)
      expect(ticks()).toBe(1)
      vi.advanceTimersByTime(1)
      expect(ticks()).toBe(2)

      vi.advanceTimersByTime(166 * 3)
      expect(ticks()).toBe(5)
    })

    it('honours configured cadences over the defaults', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({
        repeatDelayMilliseconds: 100,
        repeatMilliseconds: 20,
        longPressMilliseconds: 10_000
      })
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      vi.advanceTimersByTime(100 + 20 * 4)

      expect(output.filter((gesture) => gesture.kind === 'repeatTick')).toHaveLength(5)
    })

    it('stops ticking the moment the control comes back up', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({
        repeatDelayMilliseconds: 100,
        repeatMilliseconds: 20
      })
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      vi.advanceTimersByTime(140)
      const beforeRelease = output.filter((gesture) => gesture.kind === 'repeatTick').length
      expect(beforeRelease).toBeGreaterThan(0)

      engine.consume(event('buttonA', false, 1.14))
      vi.advanceTimersByTime(500)

      expect(output.filter((gesture) => gesture.kind === 'repeatTick')).toHaveLength(beforeRelease)
    })

    it('runs the long press and the repeat ticks off the same hold', () => {
      const output: ControllerGesture[] = []
      // Defaults: repeat at 350/166, long press at 550.
      const engine = new GestureEngine()
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      vi.advanceTimersByTime(900)

      // 350, 516, 682, 848 — the long press does not cancel the repeat.
      expect(output.filter((gesture) => gesture.kind === 'repeatTick')).toHaveLength(4)
      expect(output.filter((gesture) => gesture.kind === 'longPress')).toHaveLength(1)

      // The long press is emitted between the first and second ticks.
      const kinds = output.map((gesture) => gesture.kind)
      expect(kinds.indexOf('longPress')).toBeGreaterThan(kinds.indexOf('repeatTick'))

      // And the hold produced no tap on release, because the long press fired.
      engine.consume(event('buttonA', false, 1.9))
      vi.advanceTimersByTime(500)
      expect(output.filter((gesture) => gesture.kind === 'tap')).toHaveLength(0)
    })

    it('carries the press layer on every tick', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ repeatDelayMilliseconds: 50, repeatMilliseconds: 10 })
      engine.layerAtPress = () => 'review'
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      vi.advanceTimersByTime(80)

      const ticks = output.filter((gesture) => gesture.kind === 'repeatTick')
      expect(ticks.length).toBeGreaterThan(0)
      expect(ticks.every((gesture) => gesture.layer === 'review')).toBe(true)
    })
  })

  /**
   * A chord that the profile does not bind is not a chord: both presses have to
   * stay ordinary presses, or holding L1 while pressing Cross would swallow
   * Cross's own binding.
   */
  describe('a chord the caller rejects', () => {
    it('emits no chord and leaves both presses to behave normally', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({
        chordMilliseconds: 180,
        longPressMilliseconds: 500,
        repeatDelayMilliseconds: 300,
        repeatMilliseconds: 100
      })
      const asked: Array<[string, string]> = []
      engine.shouldRecognizeChord = (first, second) => {
        asked.push([first, second])
        return false
      }
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.consume(event('buttonB', true, 1.1))

      expect(asked).toEqual([['buttonB', 'buttonA']])
      expect(output.filter((gesture) => gesture.kind === 'chord')).toHaveLength(0)

      vi.advanceTimersByTime(600)
      // Both presses kept their own long-press and repeat timers.
      expect(
        output.filter((gesture) => gesture.kind === 'longPress').map((gesture) => gesture.input)
      ).toEqual(['buttonA', 'buttonB'])
      expect(
        new Set(
          output.filter((gesture) => gesture.kind === 'repeatTick').map((gesture) => gesture.input)
        )
      ).toEqual(new Set(['buttonA', 'buttonB']))
    })

    it('lets the rejected second press still resolve as its own tap', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({
        chordMilliseconds: 180,
        doubleTapMilliseconds: 200,
        longPressMilliseconds: 5_000,
        repeatDelayMilliseconds: 5_000
      })
      engine.shouldRecognizeChord = () => false
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.consume(event('buttonB', true, 1.05))
      engine.consume(event('buttonB', false, 1.1))
      vi.advanceTimersByTime(201)

      expect(
        output.filter((gesture) => gesture.kind === 'tap').map((gesture) => gesture.input)
      ).toEqual(['buttonB'])
    })

    it('rejects only the pair it was asked about', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ chordMilliseconds: 180, longPressMilliseconds: 5_000 })
      engine.shouldRecognizeChord = (_first, second) => second !== 'buttonA'
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.consume(event('buttonB', true, 1.05))

      expect(output.filter((gesture) => gesture.kind === 'chord')).toHaveLength(0)
    })

    it('does not ask about a press that fell outside the chord window', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ chordMilliseconds: 180, longPressMilliseconds: 5_000 })
      const shouldRecognizeChord = vi.fn(() => true)
      engine.shouldRecognizeChord = shouldRecognizeChord
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.consume(event('buttonB', true, 1.25))

      expect(shouldRecognizeChord).not.toHaveBeenCalled()
      expect(output.filter((gesture) => gesture.kind === 'chord')).toHaveLength(0)
    })

    it('treats a missing predicate as consent', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ chordMilliseconds: 180 })
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.consume(event('buttonB', true, 1.05))

      expect(output.filter((gesture) => gesture.kind === 'chord')).toHaveLength(1)
    })
  })

  /**
   * Stick rotation is recovered from positions rather than press events, so it
   * enters the stream through its own door.
   */
  describe('emitRotation', () => {
    it('maps each step onto its gesture kind', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine()
      engine.onGesture = (gesture) => output.push(gesture)

      engine.emitRotation('rightStickClick', 'clockwise', 4)
      engine.emitRotation('rightStickClick', 'counterclockwise', 5)

      expect(output).toEqual([
        {
          input: 'rightStickClick',
          secondaryInput: undefined,
          kind: 'rotateClockwise',
          timestamp: 4,
          layer: undefined
        },
        {
          input: 'rightStickClick',
          secondaryInput: undefined,
          kind: 'rotateCounterClockwise',
          timestamp: 5,
          layer: undefined
        }
      ])
    })

    it('needs no press behind it and starts none', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({
        longPressMilliseconds: 100,
        repeatDelayMilliseconds: 100,
        doubleTapMilliseconds: 100
      })
      engine.onGesture = (gesture) => output.push(gesture)

      engine.emitRotation('leftStickClick', 'clockwise', 1)
      vi.advanceTimersByTime(1_000)

      expect(output.map((gesture) => gesture.kind)).toEqual(['rotateClockwise'])
    })

    it('defaults the timestamp to the current clock in seconds', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine()
      engine.onGesture = (gesture) => output.push(gesture)
      const expected = performance.now() / 1_000

      engine.emitRotation('leftStickClick', 'clockwise')

      expect(output[0].timestamp).toBeCloseTo(expected, 1)
    })

    it('reports the layer of the stick press it happens under', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ longPressMilliseconds: 5_000 })
      engine.layerAtPress = () => 'voice'
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.emitRotation('buttonA', 'clockwise', 2)

      expect(output.at(-1)).toMatchObject({ kind: 'rotateClockwise', layer: 'voice' })
    })

    it('does not reuse the layer of a completed stick click', () => {
      const output: ControllerGesture[] = []
      const engine = new GestureEngine({ doubleTapMilliseconds: 100 })
      let layer: 'base' | 'voice' = 'base'
      engine.layerAtPress = () => layer
      engine.onGesture = (gesture) => output.push(gesture)

      engine.consume(event('buttonA', true, 1))
      engine.consume(event('buttonA', false, 1.1))
      layer = 'voice'
      vi.advanceTimersByTime(101)
      engine.emitRotation('buttonA', 'clockwise', 2)

      expect(output.find((gesture) => gesture.kind === 'tap')?.layer).toBe('base')
      expect(output.at(-1)).toMatchObject({
        kind: 'rotateClockwise',
        layer: undefined
      })
    })
  })
})
