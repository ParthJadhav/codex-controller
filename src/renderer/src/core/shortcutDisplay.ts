import type { KeyboardShortcut, ShortcutModifier } from '@shared/contracts'

const modifierSymbols: Record<ShortcutModifier, string> = {
  control: '⌃',
  option: '⌥',
  shift: '⇧',
  command: '⌘'
}

/** macOS renders modifiers in a fixed order regardless of press order. */
const modifierOrder: ShortcutModifier[] = ['control', 'option', 'shift', 'command']

export const formatShortcut = (shortcut?: KeyboardShortcut): string | null => {
  if (!shortcut) return null
  const modifiers = modifierOrder
    .filter((modifier) => shortcut.modifiers.includes(modifier))
    .map((modifier) => modifierSymbols[modifier])
    .join('')
  return `${modifiers}${shortcut.keyDisplay}`
}
