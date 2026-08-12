import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3
} from 'three'
import type { ControllerInputId } from '@shared/contracts'
import { describe, expect, it } from 'vitest'
import {
  classifyDualSenseComponent,
  splitBufferGeometryIntoComponents,
  splitDualSenseIntoParts,
  styleDualSensePartMaterial,
  type ComponentDescriptor
} from './dualsenseParts'

const descriptor = (
  center: [number, number, number],
  size: [number, number, number],
  triangleCount: number
): ComponentDescriptor => ({
  center: new Vector3(...center),
  size: new Vector3(...size),
  triangleCount
})

describe('DualSense model parts', () => {
  it('splits disconnected geometry into complete mesh components', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          0, 0, 0,
          1, 0, 0,
          0, 1, 0,
          4, 0, 0,
          5, 0, 0,
          4, 1, 0
        ]),
        3
      )
    )

    const components = splitBufferGeometryIntoComponents(geometry)

    expect(components).toHaveLength(2)
    expect(components.every((component) => component.triangleCount === 1)).toBe(true)
  })

  it('maps the source model face-button components to physical inputs', () => {
    expect(
      classifyDualSenseComponent(
        {
          center: new Vector3(0.6225, 0.129, 0.3),
          size: new Vector3(0.126, 0.126, 0.04),
          triangleCount: 1_024
        },
        1
      )
    ).toBe('buttonA')
    expect(
      classifyDualSenseComponent(
        {
          center: new Vector3(-0.6202, 0.3726, 0.29),
          size: new Vector3(0.127, 0.153, 0.06),
          triangleCount: 1_662
        },
        1
      )
    ).toBe('dpadUp')
  })

  it('keeps controller shells out of the interactive part map', () => {
    expect(
      classifyDualSenseComponent(
        {
          center: new Vector3(0, -0.1, 0.16),
          size: new Vector3(1.95, 1.03, 0.72),
          triangleCount: 24_824
        },
        0
      )
    ).toBeNull()
  })

  it('styles the touchpad as a light surface with a texture-free active-state base', () => {
    const material = new MeshStandardMaterial({
      color: '#111111',
      map: new Texture(),
      roughness: 0.2,
      metalness: 0.5
    })

    styleDualSensePartMaterial('touchpad', material)

    expect(material.map).toBeNull()
    expect(material.color.getHexString()).toBe('f4f3ef')
    expect(material.roughness).toBe(0.56)
    expect(material.metalness).toBe(0.015)
  })

  it('leaves a part with no material untouched', () => {
    expect(() => styleDualSensePartMaterial('touchpad', null)).not.toThrow()
  })
})

/**
 * The classifier is the only thing standing between the GLB's anonymous
 * connected components and the input ids the whole app addresses parts by. Each
 * rung below is a separate coordinate window in the source model, so each needs
 * its own case: a window that drifts silently turns a control into scenery.
 */
describe('classifyDualSenseComponent', () => {
  describe('the first source mesh', () => {
    it('recognizes the touchpad by its width across the top', () => {
      expect(classifyDualSenseComponent(descriptor([0, 0.52, 0.3], [0.8, 0.3, 0.05], 240), 0)).toBe(
        'touchpad'
      )
    })

    it.each([
      ['too narrow', descriptor([0, 0.52, 0.3], [0.6, 0.3, 0.05], 240)],
      ['too short', descriptor([0, 0.52, 0.3], [0.8, 0.15, 0.05], 240)],
      ['too low', descriptor([0, 0.2, 0.3], [0.8, 0.3, 0.05], 240)],
      ['off centre', descriptor([0.2, 0.52, 0.3], [0.8, 0.3, 0.05], 240)]
    ])('does not mistake a %s component for the touchpad', (_label, component) => {
      expect(classifyDualSenseComponent(component, 0)).toBeNull()
    })

    it('recognizes both stick heads by the sign of their x', () => {
      expect(
        classifyDualSenseComponent(descriptor([-0.3176, 0.01, 0.2], [0.26, 0.26, 0.2], 3_000), 0)
      ).toBe('leftStickClick')
      expect(
        classifyDualSenseComponent(descriptor([0.3176, -0.01, 0.2], [0.26, 0.26, 0.2], 3_000), 0)
      ).toBe('rightStickClick')
    })

    it('rejects a stick-shaped component that is the wrong width', () => {
      expect(
        classifyDualSenseComponent(descriptor([-0.3176, 0.01, 0.2], [0.31, 0.26, 0.2], 3_000), 0)
      ).toBeNull()
      expect(
        classifyDualSenseComponent(descriptor([-0.3176, 0.01, 0.2], [0.2, 0.26, 0.2], 3_000), 0)
      ).toBeNull()
    })

    it('classifies nothing else on the shell mesh', () => {
      // Face-button coordinates, but on the shell mesh rather than mesh 1.
      expect(
        classifyDualSenseComponent(descriptor([0.6225, 0.129, 0.3], [0.126, 0.126, 0.04], 1_024), 0)
      ).toBeNull()
    })
  })

  it('classifies nothing on a mesh beyond the first two', () => {
    expect(
      classifyDualSenseComponent(descriptor([0.6225, 0.129, 0.3], [0.126, 0.126, 0.04], 1_024), 2)
    ).toBeNull()
  })

  describe('the second source mesh', () => {
    it.each([
      ['buttonA', 0.6225, 0.129],
      ['buttonB', 0.7702, 0.2757],
      ['buttonX', 0.4764, 0.276],
      ['buttonY', 0.6225, 0.423]
    ] as const)('recognizes %s', (input, x, y) => {
      expect(
        classifyDualSenseComponent(descriptor([x, y, 0.3], [0.126, 0.126, 0.04], 1_024), 1)
      ).toBe(input)
    })

    it.each([
      ['dpadUp', -0.6202, 0.3726],
      ['dpadDown', -0.6262, 0.1801],
      ['dpadLeft', -0.7195, 0.2796],
      ['dpadRight', -0.5274, 0.2735]
    ] as const)('recognizes %s', (input, x, y) => {
      expect(
        classifyDualSenseComponent(descriptor([x, y, 0.29], [0.127, 0.153, 0.06], 1_662), 1)
      ).toBe(input)
    })

    it('does not read a face button out of a d-pad-sized component', () => {
      // Right where buttonA sits, but with the d-pad's triangle budget.
      expect(
        classifyDualSenseComponent(descriptor([0.6225, 0.129, 0.3], [0.126, 0.126, 0.04], 1_662), 1)
      ).toBeNull()
    })

    it('recognizes both stick heads', () => {
      expect(
        classifyDualSenseComponent(descriptor([-0.3176, 0.02, 0.2], [0.26, 0.26, 0.2], 4_000), 1)
      ).toBe('leftStickClick')
      expect(
        classifyDualSenseComponent(descriptor([0.3176, 0.02, 0.2], [0.26, 0.26, 0.2], 4_000), 1)
      ).toBe('rightStickClick')
    })

    it('recognizes view on the left and menu on the right', () => {
      expect(
        classifyDualSenseComponent(descriptor([-0.4672, 0.4965, 0.3], [0.06, 0.1, 0.03], 400), 1)
      ).toBe('view')
      expect(
        classifyDualSenseComponent(descriptor([0.4672, 0.4965, 0.3], [0.06, 0.1, 0.03], 400), 1)
      ).toBe('menu')
    })

    it('recognizes the home button in the middle of the front face', () => {
      expect(
        classifyDualSenseComponent(descriptor([0, 0.01, 0.3], [0.14, 0.1, 0.04], 1_400), 1)
      ).toBe('home')
    })

    it.each([
      ['sits behind the front face', descriptor([0, 0.01, 0.1], [0.14, 0.1, 0.04], 1_400)],
      ['is too coarse', descriptor([0, 0.01, 0.3], [0.14, 0.1, 0.04], 900)],
      ['is too wide', descriptor([0, 0.01, 0.3], [0.2, 0.1, 0.04], 1_400)]
    ])('does not call a component that %s the home button', (_label, component) => {
      expect(classifyDualSenseComponent(component, 1)).toBeNull()
    })

    it('splits the shoulders and the triggers by the sign of z', () => {
      expect(
        classifyDualSenseComponent(descriptor([-0.6235, 0.595, 0.12], [0.2, 0.08, 0.1], 900), 1)
      ).toBe('leftShoulder')
      expect(
        classifyDualSenseComponent(descriptor([0.6235, 0.595, 0.12], [0.2, 0.08, 0.1], 900), 1)
      ).toBe('rightShoulder')
      expect(
        classifyDualSenseComponent(descriptor([-0.6052, 0.5742, -0.12], [0.2, 0.14, 0.2], 1_800), 1)
      ).toBe('leftTrigger')
      expect(
        classifyDualSenseComponent(descriptor([0.6052, 0.5742, -0.12], [0.2, 0.14, 0.2], 1_800), 1)
      ).toBe('rightTrigger')
    })

    it('classifies a shoulder-height component sitting exactly on the z plane as neither', () => {
      expect(
        classifyDualSenseComponent(descriptor([-0.6235, 0.595, 0], [0.2, 0.08, 0.1], 900), 1)
      ).toBeNull()
    })

    it('classifies an unrecognized component as scenery', () => {
      expect(
        classifyDualSenseComponent(descriptor([0, -0.6, 0.1], [0.4, 0.4, 0.2], 50), 1)
      ).toBeNull()
    })
  })
})

/**
 * A connected fan of `triangles` triangles, centred on `center` and spanning
 * `2 * radiusX` by `2 * radiusY`. Every triangle shares the centre vertex, so
 * the whole fan is one connected component to the splitter, and its triangle
 * count is what puts it inside or outside a classification window.
 */
const fan = (
  center: [number, number, number],
  radiusX: number,
  radiusY: number,
  triangles: number
): number[] => {
  const [cx, cy, cz] = center
  const points: number[] = []
  const rim = (step: number): [number, number] => {
    const angle = (step / triangles) * Math.PI * 2
    return [cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY]
  }
  for (let step = 0; step < triangles; step += 1) {
    const [x1, y1] = rim(step)
    const [x2, y2] = rim(step + 1)
    points.push(cx, cy, cz, x1, y1, cz, x2, y2, cz)
  }
  return points
}

const meshFrom = (name: string, points: number[]): Mesh => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3))
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array(points.map(() => 0)), 3)
  )
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }))
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * A stand-in for the loaded GLB: mesh 0 is the shell that carries the touchpad,
 * mesh 1 carries the buttons. Face buttons need a triangle count in the
 * classifier's 700–1,200 window, which is why the fans are that dense.
 */
const fakeDualSenseModel = (): { model: Group; shell: Mesh; buttons: Mesh } => {
  const model = new Group()
  const shell = meshFrom('shell', [
    ...fan([0, -0.1, 0.16], 0.9, 0.5, 12),
    ...fan([0, 0.52, 0.3], 0.42, 0.16, 24)
  ])
  const buttons = meshFrom('buttons', [
    ...fan([0.6225, 0.129, 0.3], 0.06, 0.06, 800),
    ...fan([0.7702, 0.2757, 0.3], 0.06, 0.06, 800),
    ...fan([0.4764, 0.276, 0.3], 0.06, 0.06, 800),
    ...fan([0.6225, 0.423, 0.3], 0.06, 0.06, 800),
    ...fan([0, -0.6, 0.1], 0.2, 0.2, 10)
  ])
  model.add(shell)
  model.add(buttons)
  return { model, shell, buttons }
}

describe('splitDualSenseIntoParts', () => {
  it('lifts every classified component out of the shell into its own addressable mesh', () => {
    const { model, shell, buttons } = fakeDualSenseModel()

    const { parts, raycastMeshes } = splitDualSenseIntoParts(model)

    expect([...parts.keys()].sort()).toEqual([
      'buttonA',
      'buttonB',
      'buttonX',
      'buttonY',
      'touchpad'
    ])
    expect(raycastMeshes).toHaveLength(5)
    expect(raycastMeshes.map((mesh) => mesh.name).sort()).toEqual([
      'dualsense-part:buttonA',
      'dualsense-part:buttonB',
      'dualsense-part:buttonX',
      'dualsense-part:buttonY',
      'dualsense-part:touchpad'
    ])
    // Both source meshes keep only what nothing claimed.
    expect(shell.geometry.getIndex()?.count).toBe(12 * 3)
    expect(buttons.geometry.getIndex()?.count).toBe(10 * 3)
  })

  it('tags each part mesh with the input it stands for and parks it at its rest pose', () => {
    const { model } = fakeDualSenseModel()

    const { parts } = splitDualSenseIntoParts(model)
    const record = parts.get('buttonA')![0]

    expect(record.mesh.userData.controllerInput).toBe('buttonA')
    expect(record.mesh.position.x).toBeCloseTo(0.6225, 3)
    expect(record.restPosition.equals(record.mesh.position)).toBe(true)
    expect(record.restRotation.x).toBe(record.mesh.rotation.x)
    expect(record.mesh.castShadow).toBe(true)
  })

  it('gives every part its own material rather than sharing the source one', () => {
    const { model, buttons } = fakeDualSenseModel()
    const sourceMaterial = buttons.material as MeshStandardMaterial

    const { parts } = splitDualSenseIntoParts(model)
    const a = parts.get('buttonA')![0]
    const b = parts.get('buttonB')![0]

    expect(a.material).not.toBe(sourceMaterial)
    expect(a.material).not.toBe(b.material)
    // Face-button styling ran on the clone, not on the shared source.
    expect(a.material!.color.getHexString()).toBe('bbbcbf')
    expect(a.material!.map).toBeNull()
    expect(sourceMaterial.map).not.toBeNull()
  })

  it('records the base look each part animates away from and back to', () => {
    const { model } = fakeDualSenseModel()

    const { parts } = splitDualSenseIntoParts(model)
    const record = parts.get('touchpad')![0]

    expect(record.baseColor.getHexString()).toBe('f4f3ef')
    expect(record.baseRoughness).toBe(0.56)
    expect(record.baseEmissiveIntensity).toBe(record.material!.emissiveIntensity)
    expect(record).toMatchObject({
      highlight: 0,
      emphasis: 0,
      pressed: false,
      focused: false,
      tone: 'none'
    })
  })

  it('hangs an invisible additive halo off every part', () => {
    const { model } = fakeDualSenseModel()

    const { parts } = splitDualSenseIntoParts(model)
    const record = parts.get('buttonX')![0]

    expect(record.halo.name).toBe('dualsense-glow:buttonX')
    expect(record.halo.parent).toBe(record.mesh)
    expect(record.halo.visible).toBe(false)
    expect(record.halo.material.opacity).toBe(0)
    expect(record.halo.scale.x).toBeCloseTo(1.09, 5)
  })

  it('reparents the parts under a group that inherits the source mesh transform', () => {
    const { model, buttons } = fakeDualSenseModel()
    buttons.position.set(0, 0.25, -0.5)
    buttons.scale.setScalar(2)
    buttons.renderOrder = 7

    const { parts } = splitDualSenseIntoParts(model)
    const group = parts.get('buttonA')![0].mesh.parent as Group

    expect(group.name).toBe('buttons:components')
    expect(group.position.y).toBeCloseTo(0.25, 5)
    expect(group.scale.x).toBe(2)
    expect(group.renderOrder).toBe(7)
    expect(group.parent).toBe(model)
  })

  it('leaves a model with no meshes alone', () => {
    const { parts, raycastMeshes } = splitDualSenseIntoParts(new Group())

    expect(parts.size).toBe(0)
    expect(raycastMeshes).toHaveLength(0)
  })

  /**
   * The GLB has no glyphs on the face buttons — the shapes are drawn here, on
   * the frontmost component of each button, so they move with the press.
   */
  describe('face-button symbols', () => {
    it('draws one symbol on each of the four face buttons and nothing else', () => {
      const { model } = fakeDualSenseModel()

      const { parts } = splitDualSenseIntoParts(model)

      for (const input of ['buttonA', 'buttonB', 'buttonX', 'buttonY'] as ControllerInputId[]) {
        const record = parts.get(input)![0]
        const symbol = record.mesh.children.find(
          (child): child is LineSegments => child instanceof LineSegments
        )
        expect(symbol?.name).toBe(`dualsense-symbol:${input}`)
        expect(symbol?.renderOrder).toBe(85)
        expect(record.symbolMaterial).toBe(symbol?.material)
        expect(record.symbolMaterial?.transparent).toBe(true)
        expect(record.symbolMaterial?.color.getHexString()).toBe('464b55')
      }

      const touchpad = parts.get('touchpad')![0]
      expect(touchpad.symbolMaterial).toBeUndefined()
      expect(touchpad.mesh.children.some((child) => child instanceof LineSegments)).toBe(false)
    })

    it('gives each glyph the vertex count of its own shape', () => {
      const { model } = fakeDualSenseModel()

      const { parts } = splitDualSenseIntoParts(model)
      const vertices = (input: ControllerInputId): number => {
        const symbol = parts
          .get(input)![0]
          .mesh.children.find((child): child is LineSegments => child instanceof LineSegments)!
        return symbol.geometry.getAttribute('position').count
      }

      expect(vertices('buttonA')).toBe(4) // a cross: two segments
      expect(vertices('buttonX')).toBe(8) // a square: four segments
      expect(vertices('buttonY')).toBe(6) // a triangle: three segments
      expect(vertices('buttonB')).toBe(56) // a circle: twenty-eight segments
    })

    it('floats each glyph just in front of the button it belongs to', () => {
      const { model } = fakeDualSenseModel()

      const { parts } = splitDualSenseIntoParts(model)
      const record = parts.get('buttonA')![0]
      const symbol = record.mesh.children.find(
        (child): child is LineSegments => child instanceof LineSegments
      )!
      record.mesh.geometry.computeBoundingBox()
      const front = record.mesh.geometry.boundingBox!.max.z

      const positions = symbol.geometry.getAttribute('position')
      for (let index = 0; index < positions.count; index += 1) {
        expect(positions.getZ(index)).toBeCloseTo(front + 0.0016, 5)
      }
    })
  })
})
