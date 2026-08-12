import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Box3,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3
} from 'three'
import type { ControllerInputId } from '@shared/contracts'

export interface ComponentDescriptor {
  center: Vector3
  size: Vector3
  triangleCount: number
}

export interface DualSensePartMesh {
  mesh: Mesh<BufferGeometry, Material>
  material: MeshStandardMaterial | null
  halo: Mesh<BufferGeometry, MeshBasicMaterial>
  restPosition: Vector3
  restRotation: Mesh['rotation']
  baseColor: Color
  baseEmissive: Color
  baseEmissiveIntensity: number
  baseRoughness: number
  highlight: number
  /** Animated halo opacity. Carries selection, hover, conflict, and mapped state. */
  emphasis: number
  /**
   * Last discrete state applied to this part's materials. The render loop
   * compares against these to tell "nothing changed" from "still animating",
   * so it can stop submitting frames once the scene is at rest.
   */
  pressed: boolean
  focused: boolean
  tone: string
  symbolMaterial?: LineBasicMaterial
}

export interface SplitDualSenseResult {
  raycastMeshes: Mesh[]
  parts: Map<ControllerInputId, DualSensePartMesh[]>
}

interface GeometryComponent extends ComponentDescriptor {
  geometry: BufferGeometry
  sourceIndices: number[]
}

const FACE_BUTTONS: Array<[ControllerInputId, number, number]> = [
  ['buttonA', 0.6225, 0.129],
  ['buttonB', 0.7702, 0.2757],
  ['buttonX', 0.4764, 0.276],
  ['buttonY', 0.6225, 0.423]
]

const DPAD_BUTTONS: Array<[ControllerInputId, number, number]> = [
  ['dpadUp', -0.6202, 0.3726],
  ['dpadDown', -0.6262, 0.1801],
  ['dpadLeft', -0.7195, 0.2796],
  ['dpadRight', -0.5274, 0.2735]
]

const distance2d = (descriptor: ComponentDescriptor, x: number, y: number): number =>
  Math.hypot(descriptor.center.x - x, descriptor.center.y - y)

export const classifyDualSenseComponent = (
  descriptor: ComponentDescriptor,
  sourceMeshIndex: number
): ControllerInputId | null => {
  const { center, size, triangleCount } = descriptor

  if (sourceMeshIndex === 0) {
    if (
      Math.abs(center.x) < 0.04 &&
      center.y > 0.4 &&
      size.x > 0.72 &&
      size.y > 0.2
    ) {
      return 'touchpad'
    }
    if (
      Math.abs(Math.abs(center.x) - 0.3176) < 0.035 &&
      Math.abs(center.y) < 0.04 &&
      size.x > 0.22 &&
      size.x < 0.3
    ) {
      return center.x < 0 ? 'leftStickClick' : 'rightStickClick'
    }
    return null
  }

  if (sourceMeshIndex !== 1) return null

  if (triangleCount >= 700 && triangleCount <= 1_200 && size.x < 0.17 && size.y < 0.17) {
    const face = FACE_BUTTONS.find(([, x, y]) => distance2d(descriptor, x, y) < 0.035)
    if (face) return face[0]
  }

  if (
    triangleCount >= 1_500 &&
    triangleCount <= 3_100 &&
    size.x < 0.18 &&
    size.y < 0.18
  ) {
    const direction = DPAD_BUTTONS.find(([, x, y]) => distance2d(descriptor, x, y) < 0.04)
    if (direction) return direction[0]
  }

  if (
    Math.abs(Math.abs(center.x) - 0.3176) < 0.035 &&
    Math.abs(center.y) < 0.04 &&
    size.x > 0.22 &&
    size.x < 0.3
  ) {
    return center.x < 0 ? 'leftStickClick' : 'rightStickClick'
  }

  if (
    Math.abs(Math.abs(center.x) - 0.4672) < 0.04 &&
    Math.abs(center.y - 0.4965) < 0.05 &&
    size.x < 0.08 &&
    size.y < 0.12
  ) {
    return center.x < 0 ? 'view' : 'menu'
  }

  if (
    Math.abs(center.x) < 0.08 &&
    center.y > -0.05 &&
    center.y < 0.08 &&
    center.z > 0.22 &&
    size.x < 0.17 &&
    size.y < 0.13 &&
    triangleCount >= 1_100
  ) {
    return 'home'
  }

  if (
    Math.abs(Math.abs(center.x) - 0.6235) < 0.055 &&
    Math.abs(center.y - 0.595) < 0.055 &&
    center.z > 0
  ) {
    return center.x < 0 ? 'leftShoulder' : 'rightShoulder'
  }

  if (
    Math.abs(Math.abs(center.x) - 0.6052) < 0.055 &&
    Math.abs(center.y - 0.5742) < 0.055 &&
    center.z < 0
  ) {
    return center.x < 0 ? 'leftTrigger' : 'rightTrigger'
  }

  return null
}

const pointKey = (positions: BufferAttribute, index: number): string =>
  `${Math.round(positions.getX(index) * 100_000)}:${Math.round(
    positions.getY(index) * 100_000
  )}:${Math.round(positions.getZ(index) * 100_000)}`

const attributeValue = (attribute: BufferAttribute, index: number, component: number): number => {
  switch (component) {
    case 0:
      return attribute.getX(index)
    case 1:
      return attribute.getY(index)
    case 2:
      return attribute.getZ(index)
    case 3:
      return attribute.getW(index)
    default:
      return 0
  }
}

export const splitBufferGeometryIntoComponents = (
  geometry: BufferGeometry
): GeometryComponent[] => {
  const positions = geometry.getAttribute('position') as BufferAttribute | undefined
  if (!positions) return []
  const indices = geometry.getIndex()
  const triangleCount = (indices?.count ?? positions.count) / 3
  const triangles: number[][] = []
  const trianglesByPoint = new Map<string, number[]>()

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const sourceIndices = [0, 1, 2].map((offset) =>
      indices ? indices.getX(triangle * 3 + offset) : triangle * 3 + offset
    )
    triangles.push(sourceIndices)
    for (const sourceIndex of sourceIndices) {
      const key = pointKey(positions, sourceIndex)
      trianglesByPoint.set(key, [...(trianglesByPoint.get(key) ?? []), triangle])
    }
  }

  const visited = new Set<number>()
  const components: GeometryComponent[] = []
  for (let start = 0; start < triangleCount; start += 1) {
    if (visited.has(start)) continue
    const pending = [start]
    const memberTriangles: number[] = []
    visited.add(start)
    while (pending.length > 0) {
      const triangle = pending.pop()
      if (triangle === undefined) break
      memberTriangles.push(triangle)
      for (const sourceIndex of triangles[triangle]) {
        for (const neighbor of trianglesByPoint.get(pointKey(positions, sourceIndex)) ?? []) {
          if (visited.has(neighbor)) continue
          visited.add(neighbor)
          pending.push(neighbor)
        }
      }
    }

    const componentGeometry = new BufferGeometry()
    for (const [name, source] of Object.entries(geometry.attributes)) {
      const attribute = source as BufferAttribute
      const values: number[] = []
      for (const triangle of memberTriangles) {
        for (const sourceIndex of triangles[triangle]) {
          for (let component = 0; component < attribute.itemSize; component += 1) {
            values.push(attributeValue(attribute, sourceIndex, component))
          }
        }
      }
      const ArrayType = attribute.array.constructor as new (values: ArrayLike<number>) => ArrayLike<number>
      componentGeometry.setAttribute(
        name,
        new BufferAttribute(
          new ArrayType(values) as BufferAttribute['array'],
          attribute.itemSize,
          attribute.normalized
        )
      )
    }
    componentGeometry.computeBoundingBox()
    componentGeometry.computeBoundingSphere()
    const bounds = componentGeometry.boundingBox ?? new Box3()
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    componentGeometry.translate(-center.x, -center.y, -center.z)
    componentGeometry.computeBoundingBox()
    componentGeometry.computeBoundingSphere()
    components.push({
      geometry: componentGeometry,
      center,
      size,
      triangleCount: memberTriangles.length,
      sourceIndices: memberTriangles.flatMap((triangle) => triangles[triangle])
    })
  }
  return components
}

const cloneMaterial = (material: Material | Material[]): Material =>
  (Array.isArray(material) ? material[0] : material).clone()

export const styleDualSensePartMaterial = (
  input: ControllerInputId,
  material: MeshStandardMaterial | null
): void => {
  if (!material) return
  if (input === 'touchpad') {
    material.map = null
    material.color.set('#f4f3ef')
    material.roughness = 0.56
    material.metalness = 0.015
    return
  }
  if (input.startsWith('dpad')) {
    material.color.set('#b5b4b1')
    material.roughness = 0.42
    return
  }
  if (['buttonA', 'buttonB', 'buttonX', 'buttonY', 'view', 'menu'].includes(input)) {
    if (input.startsWith('button')) material.map = null
    material.color.set('#bbbcbf')
    material.roughness = 0.36
  }
}

const symbolGeometry = (input: ControllerInputId, z: number): BufferGeometry | null => {
  const size = 0.037
  const points: number[] = []
  const segment = (x1: number, y1: number, x2: number, y2: number): void => {
    points.push(x1, y1, z, x2, y2, z)
  }
  if (input === 'buttonA') {
    segment(-size, -size, size, size)
    segment(-size, size, size, -size)
  } else if (input === 'buttonX') {
    segment(-size, -size, size, -size)
    segment(size, -size, size, size)
    segment(size, size, -size, size)
    segment(-size, size, -size, -size)
  } else if (input === 'buttonY') {
    segment(0, size * 1.12, size, -size * 0.78)
    segment(size, -size * 0.78, -size, -size * 0.78)
    segment(-size, -size * 0.78, 0, size * 1.12)
  } else if (input === 'buttonB') {
    const steps = 28
    for (let index = 0; index < steps; index += 1) {
      const start = (index / steps) * Math.PI * 2
      const end = ((index + 1) / steps) * Math.PI * 2
      segment(Math.cos(start) * size, Math.sin(start) * size, Math.cos(end) * size, Math.sin(end) * size)
    }
  } else {
    return null
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3))
  return geometry
}

const addFaceButtonSymbols = (parts: Map<ControllerInputId, DualSensePartMesh[]>): void => {
  for (const input of ['buttonA', 'buttonB', 'buttonX', 'buttonY'] as ControllerInputId[]) {
    const records = parts.get(input)
    if (!records?.length) continue
    const front = [...records].sort((left, right) => right.restPosition.z - left.restPosition.z)[0]
    front.mesh.geometry.computeBoundingBox()
    const z = (front.mesh.geometry.boundingBox?.max.z ?? 0.03) + 0.0016
    const geometry = symbolGeometry(input, z)
    if (!geometry) continue
    const material = new LineBasicMaterial({
      color: '#464b55',
      transparent: true,
      opacity: 0.96,
      toneMapped: false
    })
    const symbol = new LineSegments(geometry, material)
    symbol.name = `dualsense-symbol:${input}`
    symbol.renderOrder = 85
    front.mesh.add(symbol)
    front.symbolMaterial = material
  }
}

export const splitDualSenseIntoParts = (model: Object3D): SplitDualSenseResult => {
  const sourceMeshes: Mesh[] = []
  model.traverse((object) => {
    if (object instanceof Mesh && object.geometry instanceof BufferGeometry) {
      sourceMeshes.push(object)
    }
  })

  const raycastMeshes: Mesh[] = []
  const parts = new Map<ControllerInputId, DualSensePartMesh[]>()
  sourceMeshes.forEach((sourceMesh, sourceMeshIndex) => {
    const parent = sourceMesh.parent
    if (!parent) return
    const sourceGeometry = sourceMesh.geometry
    const components = splitBufferGeometryIntoComponents(sourceGeometry)
    const componentGroup = new Group()
    componentGroup.name = `${sourceMesh.name || 'mesh'}:components`
    componentGroup.position.copy(sourceMesh.position)
    componentGroup.quaternion.copy(sourceMesh.quaternion)
    componentGroup.scale.copy(sourceMesh.scale)
    componentGroup.visible = sourceMesh.visible
    componentGroup.renderOrder = sourceMesh.renderOrder
    parent.add(componentGroup)

    const remainderIndices: number[] = []
    for (const component of components) {
      const input = classifyDualSenseComponent(component, sourceMeshIndex)
      if (!input) {
        remainderIndices.push(...component.sourceIndices)
        component.geometry.dispose()
        continue
      }
      const material = cloneMaterial(sourceMesh.material)
      const componentMesh = new Mesh(component.geometry, material)
      componentMesh.name = `dualsense-part:${input}`
      componentMesh.position.copy(component.center)
      componentMesh.castShadow = sourceMesh.castShadow
      componentMesh.receiveShadow = sourceMesh.receiveShadow
      componentMesh.userData.controllerInput = input
      componentGroup.add(componentMesh)
      raycastMeshes.push(componentMesh)

      const standardMaterial = material instanceof MeshStandardMaterial ? material : null
      styleDualSensePartMaterial(input, standardMaterial)
      const haloMaterial = new MeshBasicMaterial({
        color: '#376dff',
        transparent: true,
        opacity: 0,
        side: BackSide,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false
      })
      const halo = new Mesh(component.geometry, haloMaterial)
      halo.name = `dualsense-glow:${input}`
      halo.scale.setScalar(1.09)
      halo.renderOrder = 70
      halo.visible = false
      componentMesh.add(halo)

      const record: DualSensePartMesh = {
        mesh: componentMesh as Mesh<BufferGeometry, Material>,
        material: standardMaterial,
        halo,
        restPosition: componentMesh.position.clone(),
        restRotation: componentMesh.rotation.clone(),
        baseColor: standardMaterial?.color.clone() ?? new Color('#ffffff'),
        baseEmissive: standardMaterial?.emissive.clone() ?? new Color('#000000'),
        baseEmissiveIntensity: standardMaterial?.emissiveIntensity ?? 0,
        baseRoughness: standardMaterial?.roughness ?? 0.5,
        highlight: 0,
        emphasis: 0,
        pressed: false,
        focused: false,
        tone: 'none'
      }
      parts.set(input, [...(parts.get(input) ?? []), record])
    }

    const baseGeometry = sourceGeometry.clone()
    baseGeometry.setIndex(remainderIndices)
    baseGeometry.computeBoundingBox()
    baseGeometry.computeBoundingSphere()
    sourceMesh.geometry = baseGeometry
    sourceGeometry.dispose()
  })

  addFaceButtonSymbols(parts)
  return { raycastMeshes, parts }
}
