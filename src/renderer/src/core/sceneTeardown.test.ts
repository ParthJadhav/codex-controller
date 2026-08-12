import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Texture
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { disposeSceneResources } from './sceneTeardown'

/**
 * The scene this app builds is not all meshes: the halo outlines are `Line` and
 * `LineSegments`, and the loaded GLTF's materials carry textures. Nothing here
 * touches WebGL — `dispose` is bookkeeping on the object, so it is observable
 * without a context.
 */
describe('disposeSceneResources', () => {
  it('disposes a Line and a LineSegments, which are not Meshes', () => {
    const root = new Group()
    const line = new Line(new BufferGeometry(), new LineBasicMaterial())
    const segments = new LineSegments(new BufferGeometry(), new LineBasicMaterial())
    root.add(line, segments)

    const spies = [line.geometry, line.material, segments.geometry, segments.material].map(
      (resource) => vi.spyOn(resource, 'dispose')
    )

    disposeSceneResources(root)

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce()
  })

  it('disposes the textures a material points at', () => {
    const material = new MeshStandardMaterial()
    material.map = new Texture()
    material.normalMap = new Texture()
    const mesh = new Mesh(new BufferGeometry(), material)

    const map = vi.spyOn(material.map, 'dispose')
    const normalMap = vi.spyOn(material.normalMap, 'dispose')

    disposeSceneResources(mesh)

    expect(map).toHaveBeenCalledOnce()
    expect(normalMap).toHaveBeenCalledOnce()
  })

  it('disposes every material of a multi-material mesh', () => {
    const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()]
    const mesh = new Mesh(new BufferGeometry(), materials)
    const spies = materials.map((material) => vi.spyOn(material, 'dispose'))

    disposeSceneResources(mesh)

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce()
  })

  /** Twenty parts share one material in this scene; it is freed once. */
  it('disposes a shared material and texture exactly once', () => {
    const texture = new Texture()
    const material = new MeshStandardMaterial({ map: texture })
    const root = new Group()
    root.add(
      new Mesh(new BufferGeometry(), material),
      new Mesh(new BufferGeometry(), material),
      new Line(new BufferGeometry(), material)
    )

    const materialSpy = vi.spyOn(material, 'dispose')
    const textureSpy = vi.spyOn(texture, 'dispose')

    disposeSceneResources(root)

    expect(materialSpy).toHaveBeenCalledOnce()
    expect(textureSpy).toHaveBeenCalledOnce()
  })

  it('walks past objects that hold nothing', () => {
    const root = new Group()
    root.add(new Group())
    expect(() => disposeSceneResources(root)).not.toThrow()
  })
})
