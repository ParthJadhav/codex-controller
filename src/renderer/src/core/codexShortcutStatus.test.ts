import { describe, expect, it } from 'vitest'
import type { CodexKeymapView } from '../hooks/useControllerApp'
import { codexShortcutSummary } from './codexShortcutStatus'

const entry = (state: 'set' | 'alreadySet' | 'conflict', commandId = 'a') => ({
  commandId,
  title: 'Something',
  accelerator: 'Ctrl+Shift+X',
  state,
  previous: null
})

const keymap = (update: Partial<CodexKeymapView> = {}): CodexKeymapView => ({
  path: '/tmp/keybindings.json',
  readable: true,
  entries: [],
  conflicts: [],
  satisfied: true,
  unwritable: [],
  ...update
})

describe('codexShortcutSummary', () => {
  it('claims nothing before the keymap has been read', () => {
    const summary = codexShortcutSummary(null)
    expect(summary.state).toBe('unknown')
    expect(summary.alert).toBeNull()
  })

  it('stays silent when everything is bound', () => {
    const summary = codexShortcutSummary(keymap({ entries: [entry('alreadySet')] }))
    expect(summary.state).toBe('settled')
    expect(summary.alert).toBeNull()
    expect(summary.action).toBeNull()
  })

  it('stays silent when the profile asks nothing of Codex', () => {
    expect(codexShortcutSummary(keymap()).state).toBe('nothingToWrite')
    expect(codexShortcutSummary(keymap()).alert).toBeNull()
  })

  it('asks to write the shortcuts that drifted', () => {
    const summary = codexShortcutSummary(
      keymap({ entries: [entry('set', 'a'), entry('alreadySet', 'b')], satisfied: false })
    )
    expect(summary.state).toBe('pending')
    expect(summary.pendingCount).toBe(1)
    expect(summary.alert).toBe('Set 1 Codex shortcut')
    expect(summary.action).toBe('apply')
  })

  it('pluralises, including verb agreement', () => {
    expect(
      codexShortcutSummary(
        keymap({ entries: [entry('set', 'a'), entry('set', 'b')], satisfied: false })
      ).alert
    ).toBe('Set 2 Codex shortcuts')
    expect(
      codexShortcutSummary(
        keymap({
          satisfied: false,
          conflicts: [
            { ...entry('conflict', 'a'), heldBy: 'x' },
            { ...entry('conflict', 'b'), heldBy: 'y' }
          ]
        })
      ).alert
    ).toBe('2 shortcuts need attention')
  })

  /**
   * A conflict cannot be fixed by writing — it needs the user to free the key —
   * so the sidebar must send them to the explanation rather than offer a button
   * that would refuse.
   */
  it('sends conflicts to the detail instead of offering to write', () => {
    const summary = codexShortcutSummary(
      keymap({
        entries: [entry('conflict')],
        conflicts: [{ ...entry('conflict'), heldBy: 'toggleTerminal' }],
        satisfied: false
      })
    )
    expect(summary.state).toBe('blocked')
    expect(summary.action).toBe('explain')
    expect(summary.alert).toMatch(/1 shortcut needs attention/)
  })

  it('treats an unwritable key as needing attention', () => {
    const summary = codexShortcutSummary(
      keymap({
        satisfied: false,
        unwritable: [
          {
            commandId: 'a',
            title: 'Something',
            shortcut: { keyCode: 0x4c, keyDisplay: '⌤', modifiers: ['control'] }
          }
        ]
      })
    )
    expect(summary.state).toBe('blocked')
    expect(summary.blockedCount).toBe(1)
  })

  /** We could not look, so we must not imply setup is complete. */
  it('reports an unreadable keymap rather than claiming it is settled', () => {
    const summary = codexShortcutSummary(keymap({ readable: false, satisfied: false }))
    expect(summary.state).toBe('blocked')
    expect(summary.alert).toMatch(/unreadable/)
    expect(summary.blockedCount).toBeGreaterThan(0)
  })

  it('prefers reporting a block over a pending write', () => {
    const summary = codexShortcutSummary(
      keymap({
        entries: [entry('set', 'a')],
        conflicts: [{ ...entry('conflict', 'b'), heldBy: 'x' }],
        satisfied: false
      })
    )
    expect(summary.state).toBe('blocked')
    expect(summary.pendingCount).toBe(0)
  })
})
