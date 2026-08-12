import { describe, expect, it } from 'vitest'
import { physicalInput } from './controllerSurfaces'

describe('controller surfaces', () => {
  it('uses the physical stick and Create meshes for virtual inputs', () => {
    expect(physicalInput('leftStickUp')).toBe('leftStickClick')
    expect(physicalInput('rightStickRight')).toBe('rightStickClick')
    expect(physicalInput('share')).toBe('view')
    expect(physicalInput('buttonA')).toBe('buttonA')
  })

  it('leaves a control that has its own mesh alone', () => {
    expect(physicalInput('leftStickClick')).toBe('leftStickClick')
    expect(physicalInput('rightStickClick')).toBe('rightStickClick')
    expect(physicalInput('touchpad')).toBe('touchpad')
  })
})
