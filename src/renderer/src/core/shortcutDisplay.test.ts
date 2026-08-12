import type { KeyboardShortcut, ShortcutModifier } from '@shared/contracts'
import { describe, expect, it } from 'vitest'
import { formatShortcut } from './shortcutDisplay'

const shortcut = (modifiers: ShortcutModifier[], keyDisplay = 'D'): KeyboardShortcut => ({
  keyCode: 2,
  modifiers,
  keyDisplay
})

describe('formatShortcut', () => {
  it('returns null for an undefined shortcut', () => {
    expect(formatShortcut()).toBeNull()
    expect(formatShortcut(undefined)).toBeNull()
  })

  it('renders a bare key with no modifier symbols', () => {
    expect(formatShortcut(shortcut([]))).toBe('D')
  })

  it.each([
    ['control', '⌃D'],
    ['option', '⌥D'],
    ['shift', '⇧D'],
    ['command', '⌘D']
  ] as const)('renders %s alone as %s', (modifier, expected) => {
    expect(formatShortcut(shortcut([modifier]))).toBe(expected)
  })

  it('orders modifiers control, option, shift, command regardless of press order', () => {
    expect(formatShortcut(shortcut(['command', 'shift', 'option', 'control']))).toBe('⌃⌥⇧⌘D')
    expect(formatShortcut(shortcut(['shift', 'command', 'control', 'option']))).toBe('⌃⌥⇧⌘D')
    expect(formatShortcut(shortcut(['control', 'option', 'shift', 'command']))).toBe('⌃⌥⇧⌘D')
  })

  it('keeps the fixed order for a partial modifier set', () => {
    expect(formatShortcut(shortcut(['command', 'control']))).toBe('⌃⌘D')
    expect(formatShortcut(shortcut(['shift', 'control']))).toBe('⌃⇧D')
    expect(formatShortcut(shortcut(['command', 'option']))).toBe('⌥⌘D')
  })

  it('emits each modifier once even when the list repeats it', () => {
    expect(formatShortcut(shortcut(['command', 'command', 'shift']))).toBe('⇧⌘D')
  })

  it('appends the stored key display verbatim, including multi-character names', () => {
    expect(formatShortcut(shortcut(['control', 'shift'], 'Space'))).toBe('⌃⇧Space')
    expect(formatShortcut(shortcut(['command'], '⇥'))).toBe('⌘⇥')
    expect(formatShortcut(shortcut([], ''))).toBe('')
  })
})
