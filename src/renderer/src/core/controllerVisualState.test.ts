import { describe, expect, it } from 'vitest'
import {
  controllerPartEmphasis,
  controllerPartHaloScale,
  controllerPartHighlight,
  controllerPartIsPressed,
  controllerPartTone
} from './controllerVisualState'

const state = (
  update: Partial<Parameters<typeof controllerPartEmphasis>[0]> = {}
): Parameters<typeof controllerPartEmphasis>[0] => ({
  activeValue: 0,
  selected: false,
  focused: false,
  hovered: false,
  mapped: false,
  conflicting: false,
  ...update
})

describe('controller part visual state', () => {
  it('keeps persistent selection visibly distinct from a physical press', () => {
    const selectedHighlight = controllerPartHighlight({
      activeValue: 0,
      selected: true,
      focused: false,
      hovered: false
    })
    const pressedHighlight = controllerPartHighlight({
      activeValue: 1,
      selected: true,
      focused: false,
      hovered: false
    })

    expect(selectedHighlight).toBeLessThan(0.5)
    expect(pressedHighlight).toBe(1)
    expect(controllerPartIsPressed(0)).toBe(false)
    expect(controllerPartIsPressed(1)).toBe(true)
  })

  it('does not treat analog movement below the press threshold as pressed', () => {
    expect(controllerPartIsPressed(0.49)).toBe(false)
    expect(controllerPartIsPressed(0.5)).toBe(true)
  })

  it('gives selection an emphasis that survives against the white shell', () => {
    // The halo is the signal that actually reads on a white controller. Driving
    // selection at a low opacity made it invisible at normal viewing size.
    expect(controllerPartEmphasis(state({ selected: true }))).toBeGreaterThan(0.8)
    expect(controllerPartHaloScale('selected')).toBeGreaterThan(
      controllerPartHaloScale('mapped')
    )
  })

  it('ranks selection above a conflict and a conflict above a plain mapping', () => {
    expect(controllerPartTone(state({ selected: true, conflicting: true, mapped: true }))).toBe(
      'selected'
    )
    expect(controllerPartTone(state({ conflicting: true, mapped: true }))).toBe('conflict')
    expect(controllerPartTone(state({ mapped: true }))).toBe('mapped')
    expect(controllerPartTone(state())).toBe('none')

    expect(controllerPartEmphasis(state({ conflicting: true }))).toBeGreaterThan(
      controllerPartEmphasis(state({ mapped: true }))
    )
  })

  it('leaves an unmapped, untouched control with no halo at all', () => {
    expect(controllerPartEmphasis(state())).toBe(0)
  })

  it('never drives a halo past full opacity when a highlighted part is pressed', () => {
    expect(controllerPartEmphasis(state({ selected: true, activeValue: 1 }))).toBeLessThanOrEqual(1)
    expect(controllerPartEmphasis(state({ hovered: true, activeValue: 1 }))).toBeLessThanOrEqual(1)
  })
})
