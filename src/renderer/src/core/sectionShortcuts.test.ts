import { describe, expect, it } from 'vitest'
import { sectionForShortcut, type SectionShortcutEvent } from './sectionShortcuts'

const press = (update: Partial<SectionShortcutEvent> & { code: string }): SectionShortcutEvent => ({
  metaKey: true,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...update
})

describe('section shortcuts', () => {
  it('maps ⌘1–⌘4 to the sidebar order', () => {
    expect(sectionForShortcut(press({ code: 'Digit1' }))).toBe('controller')
    expect(sectionForShortcut(press({ code: 'Digit2' }))).toBe('mappings')
    expect(sectionForShortcut(press({ code: 'Digit3' }))).toBe('diagnostics')
    expect(sectionForShortcut(press({ code: 'Digit4' }))).toBe('settings')
  })

  /**
   * On AZERTY the unshifted digit row types `&é"'`, so the old `Number(event.key)`
   * test was `NaN` and the advertised shortcuts never fired.
   */
  it('matches the physical digit whatever character the layout produces', () => {
    // A real AZERTY ⌘1: the physical Digit1 key types '&'.
    const azerty = new KeyboardEvent('keydown', { code: 'Digit1', key: '&', metaKey: true })
    expect(sectionForShortcut(azerty)).toBe('controller')
  })

  it('ignores digits beyond the sections', () => {
    expect(sectionForShortcut(press({ code: 'Digit5' }))).toBeNull()
  })

  it('ignores presses without Command, and Command with another modifier', () => {
    expect(sectionForShortcut(press({ code: 'Digit1', metaKey: false }))).toBeNull()
    expect(sectionForShortcut(press({ code: 'Digit1', shiftKey: true }))).toBeNull()
    expect(sectionForShortcut(press({ code: 'Digit1', altKey: true }))).toBeNull()
    expect(sectionForShortcut(press({ code: 'Digit1', ctrlKey: true }))).toBeNull()
  })

  it('ignores keys that are not the digit row', () => {
    expect(sectionForShortcut(press({ code: 'Numpad1' }))).toBeNull()
    expect(sectionForShortcut(press({ code: 'KeyA' }))).toBeNull()
  })
})
