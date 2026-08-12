import { describe, expect, it } from 'vitest'
import {
  keyDisplayForCode,
  macosKeyCodeFor,
  supportedKeyboardEventCodes
} from './macosKeyCodes'

describe('macOS virtual key codes', () => {
  it('uses the physical Carbon layout instead of alphabetical offsets', () => {
    expect(macosKeyCodeFor('KeyA')).toBe(0)
    expect(macosKeyCodeFor('KeyB')).toBe(11)
    expect(macosKeyCodeFor('KeyQ')).toBe(12)
    expect(macosKeyCodeFor('KeyZ')).toBe(6)
  })

  it('maps navigation and function keys', () => {
    expect(macosKeyCodeFor('Enter')).toBe(36)
    expect(macosKeyCodeFor('Escape')).toBe(53)
    expect(macosKeyCodeFor('F1')).toBe(122)
    expect(macosKeyCodeFor('ArrowRight')).toBe(124)
  })

  it('rejects unsupported browser-only codes', () => {
    expect(macosKeyCodeFor('BrowserBack')).toBeUndefined()
  })
})

describe('physical key labels', () => {
  it('labels a key by its physical identity, not the layout character', () => {
    expect(keyDisplayForCode('Digit1')).toBe('1')
    expect(keyDisplayForCode('Digit2')).toBe('2')
    expect(keyDisplayForCode('Semicolon')).toBe(';')
  })

  /** A one-space label is invisible and reads as "nothing recorded" downstream. */
  it('names keys whose character would be blank or ambiguous', () => {
    expect(keyDisplayForCode('Space')).toBe('Space')
    expect(keyDisplayForCode('Tab')).toBe('⇥')
    expect(keyDisplayForCode('Enter')).toBe('↩')
    expect(keyDisplayForCode('Escape')).toBe('Esc')
  })

  it('has no label for a key it cannot post', () => {
    expect(keyDisplayForCode('Numpad1')).toBeUndefined()
    expect(keyDisplayForCode('IntlBackslash')).toBeUndefined()
  })

  /**
   * The recorder needs both halves for every key it accepts, and every label has
   * to survive the autosave validator's `trim()` emptiness test.
   */
  it('pairs every supported code with a non-blank label', () => {
    expect(supportedKeyboardEventCodes.length).toBeGreaterThan(0)
    for (const code of supportedKeyboardEventCodes) {
      expect(macosKeyCodeFor(code), code).toEqual(expect.any(Number))
      expect(keyDisplayForCode(code)?.trim(), code).toBeTruthy()
    }
  })
})
