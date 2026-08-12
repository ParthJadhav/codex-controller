import { describe, expect, it } from 'vitest'
import {
  appendRotationTrace,
  rotationCounts,
  rotationVerdict,
  stickTelemetry,
  ROTATION_TRACE_LIMIT,
  type RotationTraceEntry
} from './rotationDiagnostics'

const entry = (
  input: RotationTraceEntry['input'],
  step: RotationTraceEntry['step'],
  timestamp = 0
): RotationTraceEntry => ({
  id: `${input}-${step}-${timestamp}`,
  input,
  step,
  timestamp,
  magnitude: 1,
  angleDegrees: 0
})

describe('stickTelemetry', () => {
  it('reports a centred stick as untracked with no angle', () => {
    const telemetry = stickTelemetry('right', {})
    expect(telemetry.magnitude).toBe(0)
    expect(telemetry.angleDegrees).toBe(0)
    expect(telemetry.tracking).toBe(false)
  })

  it('reads the right stick from its own four cardinal values', () => {
    const telemetry = stickTelemetry('right', { rightStickUp: 1 })
    expect(telemetry.tracking).toBe(true)
    expect(telemetry.angleDegrees).toBeCloseTo(90)
  })

  it('does not let the left stick answer for the right one', () => {
    const telemetry = stickTelemetry('right', { leftStickUp: 1 })
    expect(telemetry.magnitude).toBe(0)
    expect(telemetry.tracking).toBe(false)
  })

  it('reports deflection below the rotation threshold as untracked', () => {
    // Past the visual dead zone, short of the magnitude the tracker needs.
    const telemetry = stickTelemetry('right', { rightStickRight: 0.3 })
    expect(telemetry.magnitude).toBeGreaterThan(0)
    expect(telemetry.tracking).toBe(false)
  })

  it('converts banked travel to degrees', () => {
    const telemetry = stickTelemetry('right', { rightStickRight: 1 }, Math.PI / 2)
    expect(telemetry.bankedDegrees).toBeCloseTo(90)
  })
})

describe('appendRotationTrace', () => {
  it('keeps the newest entry first', () => {
    const trace = appendRotationTrace(
      [entry('rightStickClick', 'clockwise', 1)],
      entry('rightStickClick', 'counterclockwise', 2)
    )
    expect(trace[0]?.step).toBe('counterclockwise')
  })

  it('bounds the trace', () => {
    let trace: RotationTraceEntry[] = []
    for (let index = 0; index < ROTATION_TRACE_LIMIT + 5; index += 1) {
      trace = appendRotationTrace(trace, entry('rightStickClick', 'clockwise', index))
    }
    expect(trace).toHaveLength(ROTATION_TRACE_LIMIT)
  })

  /**
   * Regression: one shared window meant a busy stick evicted the other's
   * history, and the evicted stick's card then read "no step yet" about steps
   * that had been observed — the exact verdict the page exists to get right.
   */
  it('does not let one stick evict the other', () => {
    let trace = appendRotationTrace([], entry('rightStickClick', 'clockwise', 0))
    for (let index = 1; index <= ROTATION_TRACE_LIMIT * 2; index += 1) {
      trace = appendRotationTrace(trace, entry('leftStickClick', 'counterclockwise', index))
    }

    expect(rotationCounts(trace, 'rightStickClick')).toEqual({
      clockwise: 1,
      counterclockwise: 0
    })
    // The busy stick is still bounded — by its own window, not the shared one.
    expect(rotationCounts(trace, 'leftStickClick').counterclockwise).toBe(ROTATION_TRACE_LIMIT)
  })
})

describe('rotationCounts', () => {
  it('counts each direction for one stick without borrowing the other', () => {
    const trace = [
      entry('rightStickClick', 'clockwise', 1),
      entry('rightStickClick', 'clockwise', 2),
      entry('rightStickClick', 'counterclockwise', 3),
      entry('leftStickClick', 'clockwise', 4)
    ]
    expect(rotationCounts(trace, 'rightStickClick')).toEqual({
      clockwise: 2,
      counterclockwise: 1
    })
    expect(rotationCounts(trace, 'leftStickClick')).toEqual({
      clockwise: 1,
      counterclockwise: 0
    })
  })
})

describe('rotationVerdict', () => {
  const centred = stickTelemetry('right', {})
  const deflected = stickTelemetry('right', { rightStickRight: 1 })
  const none = { clockwise: 0, counterclockwise: 0 }

  it('reports a dead stick when nothing has arrived', () => {
    expect(rotationVerdict(centred, none, false)).toMatch(/No stick samples/)
  })

  it('separates under-threshold samples from no samples', () => {
    const shallow = stickTelemetry('right', { rightStickRight: 0.3 })
    expect(rotationVerdict(shallow, none, false)).toMatch(/under the rotation threshold/)
  })

  it('calls out a cadence problem when samples are being discarded', () => {
    const jumpy = stickTelemetry('right', { rightStickRight: 1 }, 0, 4)
    expect(rotationVerdict(jumpy, none, true)).toMatch(/cadence/)
  })

  it('reports success once a step has been seen', () => {
    expect(rotationVerdict(deflected, { clockwise: 1, counterclockwise: 0 }, true)).toMatch(
      /Detection works/
    )
  })

  it('asks for more travel when tracked but short of a step', () => {
    expect(rotationVerdict(deflected, none, true)).toMatch(/keep turning/i)
  })
})
