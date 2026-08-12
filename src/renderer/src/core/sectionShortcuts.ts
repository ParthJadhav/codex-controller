import type { AppSection } from '../hooks/useControllerApp'

/** Command-number order. The sidebar renders these numbers, so the two must agree. */
export const sectionOrder: readonly AppSection[] = [
  'controller',
  'mappings',
  'diagnostics',
  'settings'
]

/** The parts of a keydown this resolver reads, so tests need not build a real event. */
export interface SectionShortcutEvent {
  code: string
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

/**
 * The section ⌘1–⌘4 asks for, or `null` when the press is not one of them.
 *
 * Matching is on the physical digit key, not the character it produces. Reading
 * `event.key` made the advertised shortcuts unreachable on every layout where an
 * unshifted digit row types something else: on AZERTY ⌘1 arrives as `key: '&'`,
 * so `Number(event.key)` was `NaN` and nothing happened. The physical key is
 * also what the sidebar's "⌘1" label describes.
 */
export const sectionForShortcut = (event: SectionShortcutEvent): AppSection | null => {
  if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return null
  const digit = /^Digit([1-9])$/.exec(event.code)
  if (!digit) return null
  return sectionOrder[Number(digit[1]) - 1] ?? null
}
