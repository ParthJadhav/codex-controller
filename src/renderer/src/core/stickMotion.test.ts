import { describe, expect, it } from 'vitest'
import {
  STICK_VISUAL_DEAD_ZONE,
  applyRadialDeadZone,
  stickVectorFromActiveValues
} from './stickMotion'

describe('stick motion', () => {
  it('centers values inside the radial dead zone', () => {
    expect(applyRadialDeadZone(STICK_VISUAL_DEAD_ZONE / 2, 0)).toEqual({
      x: 0,
      y: 0,
      magnitude: 0
    })
  })

  it('rescales calibrated values after the dead zone without changing direction', () => {
    const vector = applyRadialDeadZone(0.6, 0.8)
    expect(vector.magnitude).toBeCloseTo(1)
    expect(vector.x).toBeCloseTo(0.6)
    expect(vector.y).toBeCloseTo(0.8)
  })

  it('derives independent left and right vectors from directional values', () => {
    const values = {
      leftStickLeft: 0.75,
      leftStickRight: 0.1,
      leftStickUp: 0.45,
      rightStickDown: 0.9
    }

    const left = stickVectorFromActiveValues('left', values)
    const right = stickVectorFromActiveValues('right', values)

    expect(left.x).toBeLessThan(0)
    expect(left.y).toBeGreaterThan(0)
    expect(right.x).toBe(0)
    expect(right.y).toBeLessThan(0)
  })

  it('returns to center when disconnect cleanup supplies no active values', () => {
    expect(stickVectorFromActiveValues('left', {})).toEqual({
      x: 0,
      y: 0,
      magnitude: 0
    })
    expect(stickVectorFromActiveValues('right', {})).toEqual({
      x: 0,
      y: 0,
      magnitude: 0
    })
  })
})
