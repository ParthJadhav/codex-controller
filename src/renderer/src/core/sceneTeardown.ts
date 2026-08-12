import type { Object3D, Texture } from 'three'

/**
 * Frees the GPU-side resources hanging off a scene graph.
 *
 * Three frees nothing when a scene is dropped: geometries, materials and
 * textures live in the WebGL context until something disposes them, and the
 * renderer only holds weak references. Two things made the old teardown leak.
 * It filtered on `instanceof Mesh`, so the halo outlines — `Line` and
 * `LineSegments`, which are not meshes — kept their geometry and material for
 * the life of the window. And disposing a material does not dispose the
 * textures it points at, so every map of the loaded DualSense GLTF survived the
 * unmount.
 *
 * So this walks by *what an object holds*, not by what class it is, and
 * follows each material to its textures. A `Set` keeps a material shared by
 * twenty parts from being disposed twenty times.
 */
export const disposeSceneResources = (root: Object3D): void => {
  const disposed = new Set<unknown>()

  const dispose = (value: unknown): void => {
    if (!isDisposable(value) || disposed.has(value)) return
    disposed.add(value)
    value.dispose()
  }

  root.traverse((object) => {
    const holder = object as Object3D & { geometry?: unknown; material?: unknown }
    dispose(holder.geometry)
    const materials = Array.isArray(holder.material) ? holder.material : [holder.material]
    for (const material of materials) {
      if (!isDisposable(material)) continue
      for (const texture of texturesOf(material)) dispose(texture)
      dispose(material)
    }
  })
}

interface Disposable {
  dispose: () => void
}

const isDisposable = (value: unknown): value is Disposable =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<Disposable>).dispose === 'function'

const isTexture = (value: unknown): value is Texture =>
  isDisposable(value) && (value as Partial<Texture>).isTexture === true

/**
 * Every texture a material can reach: its own map slots (`map`, `normalMap`,
 * `envMap`, …) and, for a shader material, whatever its uniforms hold. Reading
 * the slots by enumeration rather than by name means a material type this app
 * has not used yet still gets its maps freed.
 */
const texturesOf = (material: Disposable): Texture[] => {
  const found: Texture[] = []
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (isTexture(value)) found.push(value)
  }
  const uniforms = (material as { uniforms?: Record<string, { value?: unknown }> }).uniforms
  if (uniforms && typeof uniforms === 'object') {
    for (const uniform of Object.values(uniforms)) {
      if (isTexture(uniform?.value)) found.push(uniform.value)
    }
  }
  return found
}
