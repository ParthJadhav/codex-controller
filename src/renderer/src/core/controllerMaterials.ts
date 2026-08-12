import { Color, DoubleSide, Material, MeshStandardMaterial } from 'three'

/**
 * Restyles a material straight off the DualSense GLB for the Codex Controller look.
 *
 * The source GLB tags the two shell materials `alphaMode: BLEND`, but they are
 * used here as alpha-tested cutouts, not blended surfaces. That distinction is
 * load-bearing for performance: three.js renders a material that is both
 * `transparent` and `DoubleSide` in *two* passes, and sets `needsUpdate` on it
 * before each one — so every shell triangle is drawn twice and the material's
 * program parameters are re-derived twice per object per frame. Keeping these
 * materials opaque is visually equivalent for a solid controller body and
 * halves the geometry submitted each frame.
 */
export const prepareControllerMaterial = (source: Material): Material => {
  const material = source.clone()
  if (material instanceof MeshStandardMaterial) {
    material.roughness = source.name === '1002' ? 0.5 : source.name === '1001' ? 0.43 : 0.52
    material.metalness = source.name === '1002' ? 0.055 : 0.018
    material.envMapIntensity = 0.74
    material.color.multiply(new Color(source.name === '1001' ? '#f3f0ea' : '#e8e6e1'))
    material.emissive.set('#000000')
    material.emissiveIntensity = 0
    material.emissiveMap = null
    if (material.transparent) {
      material.alphaTest = 0.24
      material.depthWrite = true
      material.transparent = false
    }
  }
  material.side = DoubleSide
  // Belt and braces: even if something later turns `transparent` back on, never
  // re-enter the two-pass double-sided path.
  material.forceSinglePass = true
  return material
}
