import { describe, expect, it } from 'vitest'
import { StickRotationTracker } from './stickRotation'

/** Positions on the unit circle, y up, matching the stick vector convention. */
const at = (degrees: number): [number, number] => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180)
]

describe('StickRotationTracker', () => {
  it('reports a step per quarter turn clockwise', () => {
    const tracker = new StickRotationTracker()
    expect(tracker.update(...at(90))).toBeNull()
    expect(tracker.update(...at(45))).toBeNull()
    expect(tracker.update(...at(0))).toBe('clockwise')
    expect(tracker.update(...at(-45))).toBeNull()
    expect(tracker.update(...at(-90))).toBe('clockwise')
  })

  it('reports counterclockwise travel the other way', () => {
    const tracker = new StickRotationTracker()
    tracker.update(...at(0))
    expect(tracker.update(...at(45))).toBeNull()
    expect(tracker.update(...at(90))).toBe('counterclockwise')
  })

  it('ignores a stick resting near the centre', () => {
    const tracker = new StickRotationTracker()
    expect(tracker.update(0.1, 0)).toBeNull()
    expect(tracker.update(0, 0.1)).toBeNull()
    expect(tracker.update(-0.1, 0)).toBeNull()
  })

  it('does not emit an opposite step when the user reverses just past a boundary', () => {
    const tracker = new StickRotationTracker()
    tracker.update(...at(90))
    expect(tracker.update(...at(0))).toBe('clockwise')
    // Travelling back a quarter turn must not immediately count as a full step
    // the other way: the leftover from the emitted step is discarded.
    expect(tracker.update(...at(45))).toBeNull()
    expect(tracker.update(...at(90))).toBe('counterclockwise')
  })

  it('starts fresh after the stick is released', () => {
    const tracker = new StickRotationTracker()
    tracker.update(...at(90))
    tracker.update(...at(45))
    expect(tracker.update(0, 0)).toBeNull()
    // The half-turn of travel before the release is gone.
    expect(tracker.update(...at(0))).toBeNull()
  })

  /**
   * Regression: a non-finite sample is not smaller than the minimum magnitude, so
   * it used to sail past that guard and become a NaN `lastAngle`. Every later
   * delta was then NaN and the stick never produced another step.
   */
  describe('a non-finite sample', () => {
    for (const [name, x, y] of [
      ['NaN', Number.NaN, 0],
      ['Infinity', Number.POSITIVE_INFINITY, 0],
      ['a NaN y', 1, Number.NaN]
    ] as const) {
      it(`resets the tracker rather than poisoning it — ${name}`, () => {
        const tracker = new StickRotationTracker()
        tracker.update(...at(90))
        expect(tracker.update(x, y)).toBeNull()

        // A full quarter turn from a clean start still has to emit.
        expect(tracker.update(...at(90))).toBeNull()
        expect(tracker.update(...at(0))).toBe('clockwise')
        expect(tracker.accumulatedRadians).not.toBeNaN()
      })
    }
  })

  /**
   * Regression: the rejection count is evidence about the attempt being tracked.
   * Carried across a release it kept Diagnostics answering "sample cadence
   * issue" for a stick whose next circle read perfectly.
   */
  it('clears the rejected-sample count when the tracker resets', () => {
    const tracker = new StickRotationTracker()
    tracker.update(...at(0))
    // A jump larger than the maximum sample angle: a lost sample, not travel.
    tracker.update(...at(200))
    expect(tracker.rejectedSampleCount).toBe(1)

    tracker.update(0, 0)
    expect(tracker.rejectedSampleCount).toBe(0)
  })
})
