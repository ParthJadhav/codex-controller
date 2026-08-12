/**
 * The physical keys Codex Controller can post, each with the Carbon virtual key code
 * the bridge needs and the label the app shows for it.
 *
 * Code and label live in one table on purpose. The recorder used to store
 * `event.code` and display `event.key`, which are different things: on a UK
 * layout ⇧2 recorded as "⇧@" while the posted key was ⇧2, and on AZERTY the
 * digits read as `&é"'` — the label described the user's layout while the
 * binding described the physical key. Deriving the label from the same code that
 * produced the key code is what keeps the two honest, and it means a key with no
 * entry here is knowably unsupported rather than silently ignored.
 */
const physicalKeys: Readonly<Record<string, { readonly keyCode: number; readonly display: string }>> =
  {
    KeyA: { keyCode: 0, display: 'A' },
    KeyS: { keyCode: 1, display: 'S' },
    KeyD: { keyCode: 2, display: 'D' },
    KeyF: { keyCode: 3, display: 'F' },
    KeyH: { keyCode: 4, display: 'H' },
    KeyG: { keyCode: 5, display: 'G' },
    KeyZ: { keyCode: 6, display: 'Z' },
    KeyX: { keyCode: 7, display: 'X' },
    KeyC: { keyCode: 8, display: 'C' },
    KeyV: { keyCode: 9, display: 'V' },
    KeyB: { keyCode: 11, display: 'B' },
    KeyQ: { keyCode: 12, display: 'Q' },
    KeyW: { keyCode: 13, display: 'W' },
    KeyE: { keyCode: 14, display: 'E' },
    KeyR: { keyCode: 15, display: 'R' },
    KeyY: { keyCode: 16, display: 'Y' },
    KeyT: { keyCode: 17, display: 'T' },
    Digit1: { keyCode: 18, display: '1' },
    Digit2: { keyCode: 19, display: '2' },
    Digit3: { keyCode: 20, display: '3' },
    Digit4: { keyCode: 21, display: '4' },
    Digit6: { keyCode: 22, display: '6' },
    Digit5: { keyCode: 23, display: '5' },
    Equal: { keyCode: 24, display: '=' },
    Digit9: { keyCode: 25, display: '9' },
    Digit7: { keyCode: 26, display: '7' },
    Minus: { keyCode: 27, display: '-' },
    Digit8: { keyCode: 28, display: '8' },
    Digit0: { keyCode: 29, display: '0' },
    BracketRight: { keyCode: 30, display: ']' },
    KeyO: { keyCode: 31, display: 'O' },
    KeyU: { keyCode: 32, display: 'U' },
    BracketLeft: { keyCode: 33, display: '[' },
    KeyI: { keyCode: 34, display: 'I' },
    KeyP: { keyCode: 35, display: 'P' },
    Enter: { keyCode: 36, display: '↩' },
    KeyL: { keyCode: 37, display: 'L' },
    KeyJ: { keyCode: 38, display: 'J' },
    Quote: { keyCode: 39, display: "'" },
    KeyK: { keyCode: 40, display: 'K' },
    Semicolon: { keyCode: 41, display: ';' },
    Backslash: { keyCode: 42, display: '\\' },
    Comma: { keyCode: 43, display: ',' },
    Slash: { keyCode: 44, display: '/' },
    KeyN: { keyCode: 45, display: 'N' },
    KeyM: { keyCode: 46, display: 'M' },
    Period: { keyCode: 47, display: '.' },
    Tab: { keyCode: 48, display: '⇥' },
    // "Space" rather than a literal space: a one-character blank label is
    // invisible in the recorder and reads as "no shortcut recorded" to the
    // autosave validator, which trims before testing for emptiness.
    Space: { keyCode: 49, display: 'Space' },
    Backquote: { keyCode: 50, display: '`' },
    Backspace: { keyCode: 51, display: '⌫' },
    Escape: { keyCode: 53, display: 'Esc' },
    F5: { keyCode: 96, display: 'F5' },
    F6: { keyCode: 97, display: 'F6' },
    F7: { keyCode: 98, display: 'F7' },
    F3: { keyCode: 99, display: 'F3' },
    F8: { keyCode: 100, display: 'F8' },
    F9: { keyCode: 101, display: 'F9' },
    F11: { keyCode: 103, display: 'F11' },
    F13: { keyCode: 105, display: 'F13' },
    F16: { keyCode: 106, display: 'F16' },
    F14: { keyCode: 107, display: 'F14' },
    F10: { keyCode: 109, display: 'F10' },
    F12: { keyCode: 111, display: 'F12' },
    F15: { keyCode: 113, display: 'F15' },
    Home: { keyCode: 115, display: '↖' },
    PageUp: { keyCode: 116, display: '⇞' },
    Delete: { keyCode: 117, display: '⌦' },
    F4: { keyCode: 118, display: 'F4' },
    End: { keyCode: 119, display: '↘' },
    F2: { keyCode: 120, display: 'F2' },
    PageDown: { keyCode: 121, display: '⇟' },
    F1: { keyCode: 122, display: 'F1' },
    ArrowLeft: { keyCode: 123, display: '←' },
    ArrowRight: { keyCode: 124, display: '→' },
    ArrowDown: { keyCode: 125, display: '↓' },
    ArrowUp: { keyCode: 126, display: '↑' }
  }

export const macosKeyCodeFor = (keyboardEventCode: string): number | undefined =>
  physicalKeys[keyboardEventCode]?.keyCode

/**
 * The label for a physical key, independent of the keyboard layout that
 * produced it. `undefined` means Codex Controller cannot post the key at all, which
 * the recorder reports instead of swallowing the press.
 */
export const keyDisplayForCode = (keyboardEventCode: string): string | undefined =>
  physicalKeys[keyboardEventCode]?.display

/** Every code the recorder accepts, for tests that assert the two halves agree. */
export const supportedKeyboardEventCodes = Object.keys(physicalKeys)
