import type { CodexKeymapView } from '../hooks/useControllerApp'

/**
 * One reading of "does Codex have what this profile needs bound", shared by the
 * sidebar alert and the Settings row.
 *
 * Both surfaces have to agree, and they answer slightly different questions —
 * the sidebar decides whether to appear at all, Settings describes the detail.
 * Deriving both from one function is what stops them drifting into disagreeing
 * about whether setup is finished.
 */

export type CodexShortcutState =
  /** The keymap has not been read yet; claim nothing. */
  | 'unknown'
  /** Everything this profile needs is bound. */
  | 'settled'
  /** This profile asks nothing of Codex. */
  | 'nothingToWrite'
  /** Shortcuts are missing or stale and can be written. */
  | 'pending'
  /** Something is wrong that writing cannot fix. */
  | 'blocked'

export interface CodexShortcutSummary {
  state: CodexShortcutState
  /** Shortcuts that differ from Codex and could be written. */
  pendingCount: number
  /** Shortcuts that need a human decision — a conflict or an unwritable key. */
  blockedCount: number
  /** Sidebar text, or null when there is nothing worth interrupting for. */
  alert: string | null
  /** Whether clicking should write, or send the user to the detail. */
  action: 'apply' | 'explain' | null
}

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`

export const codexShortcutSummary = (keymap: CodexKeymapView | null): CodexShortcutSummary => {
  if (keymap === null) {
    return { state: 'unknown', pendingCount: 0, blockedCount: 0, alert: null, action: null }
  }

  const blockedCount = keymap.conflicts.length + keymap.unwritable.length
  // An unreadable keymap is a blocking problem even with nothing to report per
  // command: we could not look, so we must not imply setup is complete.
  if (!keymap.readable) {
    return {
      state: 'blocked',
      pendingCount: 0,
      blockedCount: Math.max(blockedCount, 1),
      alert: 'Codex shortcuts unreadable',
      action: 'explain'
    }
  }

  if (blockedCount > 0) {
    return {
      state: 'blocked',
      pendingCount: 0,
      blockedCount,
      alert: `${plural(blockedCount, 'shortcut')} ${blockedCount === 1 ? 'needs' : 'need'} attention`,
      action: 'explain'
    }
  }

  const pendingCount = keymap.entries.filter((entry) => entry.state === 'set').length
  if (pendingCount > 0) {
    return {
      state: 'pending',
      pendingCount,
      blockedCount: 0,
      alert: `Set ${plural(pendingCount, 'Codex shortcut')}`,
      action: 'apply'
    }
  }

  // No entries at all means the profile drives nothing Codex leaves unbound,
  // which is a finished state rather than an unconfigured one.
  return {
    state: keymap.entries.length === 0 ? 'nothingToWrite' : 'settled',
    pendingCount: 0,
    blockedCount: 0,
    alert: null,
    action: null
  }
}
