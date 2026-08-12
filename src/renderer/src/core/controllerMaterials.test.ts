import { DoubleSide, MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { prepareControllerMaterial } from './controllerMaterials'

/**
 * three.js renders a material that is both `transparent` and `DoubleSide` in
 * two passes, setting `needsUpdate` before each one. On this model that doubled
 * the submitted geometry (111,676 -> 211,217 triangles per frame) and re-derived
 * program parameters for every part on every frame.
 */
describe('controller material preparation', () => {
  it('keeps the alpha-tested shell out of the two-pass double-sided path', () => {
    const source = new MeshStandardMaterial({ name: '1001', transparent: true })

    const material = prepareControllerMaterial(source)

    expect(material.side).toBe(DoubleSide)
    expect(material.transparent).toBe(false)
    expect(material.forceSinglePass).toBe(true)
  })

  /**
   * The three assertions above only describe one pass through the function.
   * Preparation runs per material per load, and a material that has already
   * been through it must not be walked back into the two-pass path — the
   * `transparent` branch that installs the cutout is skipped the second time,
   * so the cutout has to survive on its own.
   */
  it('stays out of the two-pass path when an already-prepared material is prepared again', () => {
    const once = prepareControllerMaterial(
      new MeshStandardMaterial({ name: '1001', transparent: true })
    )

    const twice = prepareControllerMaterial(once)

    expect(twice.transparent).toBe(false)
    expect(twice.side).toBe(DoubleSide)
    expect(twice.forceSinglePass).toBe(true)
    expect((twice as MeshStandardMaterial).alphaTest).toBe(0.24)
    expect(twice.depthWrite).toBe(true)
  })

  it('preserves the alpha cutout that the blended source material stood in for', () => {
    const source = new MeshStandardMaterial({ name: '1011', transparent: true })

    const material = prepareControllerMaterial(source)

    expect(material.alphaTest).toBe(0.24)
    expect(material.depthWrite).toBe(true)
  })

  it('leaves an already-opaque source material opaque', () => {
    const source = new MeshStandardMaterial({ name: '1002', transparent: false })

    const material = prepareControllerMaterial(source)

    expect(material.transparent).toBe(false)
    expect(material.alphaTest).toBe(0)
  })

  it('keeps the per-material surface styling that defines the controller look', () => {
    const shell = prepareControllerMaterial(new MeshStandardMaterial({ name: '1001' }))
    const trim = prepareControllerMaterial(new MeshStandardMaterial({ name: '1002' }))

    expect((shell as MeshStandardMaterial).roughness).toBe(0.43)
    expect((shell as MeshStandardMaterial).metalness).toBe(0.018)
    expect((trim as MeshStandardMaterial).roughness).toBe(0.5)
    expect((trim as MeshStandardMaterial).metalness).toBe(0.055)
    expect((shell as MeshStandardMaterial).emissiveIntensity).toBe(0)
  })

  it('does not mutate the source material', () => {
    const source = new MeshStandardMaterial({ name: '1001', transparent: true })

    prepareControllerMaterial(source)

    expect(source.transparent).toBe(true)
  })
})
