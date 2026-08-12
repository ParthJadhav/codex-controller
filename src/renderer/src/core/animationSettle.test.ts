import { describe, expect, it } from 'vitest'
import { SETTLE_EPSILON, approachValue } from './animationSettle'

describe('animation settling', () => {
  it('lands exactly on the target in a finite number of steps', () => {
    let value = 0
    let steps = 0
    while (value !== 1 && steps < 1_000) {
      value = approachValue(value, 1, 0.18)
      steps += 1
    }

    // Plain `value += (target - value) * response` never reaches the target, so
    // a render loop could never tell "arrived" from "still moving".
    expect(value).toBe(1)
    expect(steps).toBeLessThan(100)
  })

  it('reports no further movement once settled', () => {
    const settled = approachValue(1, 1, 0.18)

    expect(settled).toBe(1)
    expect(approachValue(settled, 1, 0.18)).toBe(settled)
  })

  it('snaps only once the remaining distance is imperceptible', () => {
    const nearlyThere = 1 - SETTLE_EPSILON / 2

    expect(approachValue(nearlyThere, 1, 0.18)).toBe(1)
    expect(approachValue(0.5, 1, 0.18)).toBeLessThan(1)
  })

  it('jumps straight to the target when motion is reduced', () => {
    expect(approachValue(0, 1, 1)).toBe(1)
  })

  it('settles from either direction', () => {
    let value = 1
    let steps = 0
    while (value !== 0 && steps < 1_000) {
      value = approachValue(value, 0, 0.46)
      steps += 1
    }

    expect(value).toBe(0)
    expect(steps).toBeLessThan(50)
  })
})
