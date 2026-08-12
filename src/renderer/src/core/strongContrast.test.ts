import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

const token = (name: string): [number, number, number] => {
  const match = new RegExp(`--${name}:\\s*oklch\\((\\d*\\.?\\d+)\\s+(\\d*\\.?\\d+)\\s+(\\d*\\.?\\d+)`).exec(
    styles
  )
  if (!match) throw new Error(`Missing OKLCH token --${name}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** OKLCH → linear sRGB relative luminance, clamped to the display gamut. */
const luminance = ([lightness, chroma, hue]: [number, number, number]): number => {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const contrast = (left: [number, number, number], right: [number, number, number]): number => {
  const first = luminance(left)
  const second = luminance(right)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('small text on strong colour fills', () => {
  it.each(['accent', 'accent-hover', 'failure'] as const)(
    'keeps --on-strong above 4.5:1 on --%s',
    (background) => {
      expect(contrast(token('on-strong'), token(background))).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('uses the accessible foreground for every small-text strong-fill component', () => {
    for (const selector of [
      '.layer-chip[data-selected="true"]',
      '.ui-button--default',
      '.ui-button--destructive',
      '.ui-badge--default'
    ]) {
      const block = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(
        styles
      )?.[1]
      expect(block, selector).toContain('color: var(--on-strong)')
    }
  })

  it('does not reduce the opacity of disabled strong-fill buttons', () => {
    expect(styles).toMatch(
      /\.ui-button--default:disabled,[\s\S]*?\.ui-button--destructive:disabled\s*\{[\s\S]*?opacity:\s*1/
    )
  })
})
