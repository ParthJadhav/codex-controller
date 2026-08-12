import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CodexKeymapWriteSnapshot } from '@shared/contracts'
import { CodexRestartDialog } from './CodexRestartDialog'

const result = (update: Partial<CodexKeymapWriteSnapshot> = {}): CodexKeymapWriteSnapshot => ({
  status: 'applied',
  message: 'Set them.',
  path: '/Users/someone/.codex/keybindings.json',
  backupPath: '/Users/someone/.codex/keybindings.json.codex-controller-backup.json',
  entries: [
    {
      commandId: 'composer.increaseReasoningEffort',
      title: 'Increase reasoning effort',
      accelerator: 'Ctrl+Shift+.',
      state: 'set',
      previous: null
    }
  ],
  ...update
})

describe('CodexRestartDialog', () => {
  it('renders nothing until a write has happened', () => {
    const { container } = render(<CodexRestartDialog result={null} onDismiss={vi.fn()} />)
    expect(container.querySelector('dialog')).toBeNull()
  })

  /**
   * Codex reads its keymap at startup and does not watch the file, so a
   * successful write is not yet a working shortcut. Saying so is the whole
   * point of this dialog.
   */
  it('tells the user to restart Codex', () => {
    render(<CodexRestartDialog result={result()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Restart Codex to finish')).toBeTruthy()
    expect(screen.getByText(/only reads its keymap at startup/)).toBeTruthy()
  })

  it('lists what was written so the user can check it', () => {
    render(<CodexRestartDialog result={result()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Increase reasoning effort')).toBeTruthy()
    expect(screen.getByText('Ctrl+Shift+.')).toBeTruthy()
  })

  it('names the file and mentions the backup', () => {
    render(<CodexRestartDialog result={result()} onDismiss={vi.fn()} />)
    const note = screen.getByText(/\.codex\/keybindings\.json/)
    expect(note.textContent).toMatch(/backed up/)
  })

  it('does not promise a backup that was never made', () => {
    render(<CodexRestartDialog result={result({ backupPath: undefined })} onDismiss={vi.fn()} />)
    expect(screen.getByText(/keybindings\.json/).textContent).not.toMatch(/backed up/)
  })

  it('omits a conflicted entry, which was not written', () => {
    render(
      <CodexRestartDialog
        result={result({
          entries: [
            {
              commandId: 'composer.decreaseReasoningEffort',
              title: 'Decrease reasoning effort',
              accelerator: 'Ctrl+Shift+,',
              state: 'conflict',
              previous: null,
              heldBy: 'toggleTerminal'
            }
          ]
        })}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.queryByText('Decrease reasoning effort')).toBeNull()
  })

  /**
   * Regression: the effect carried a branch that closed a mounted dialog when
   * `result` went away. It could never run — clearing `result` unmounts the
   * dialog — and removing it must not change what the user sees.
   */
  it('takes the dialog away when the result is cleared', () => {
    const { container, rerender } = render(
      <CodexRestartDialog result={result()} onDismiss={vi.fn()} />
    )
    expect(container.querySelector('dialog')).not.toBeNull()

    rerender(<CodexRestartDialog result={null} onDismiss={vi.fn()} />)
    expect(container.querySelector('dialog')).toBeNull()
  })

  /**
   * jsdom implements no `showModal`, which is exactly the host the fallback was
   * written for: the dialog still has to end up open rather than swallowing the
   * one message that explains why the shortcut is not working yet.
   */
  it('opens on a host without showModal and stays open across re-renders', () => {
    const { container, rerender } = render(
      <CodexRestartDialog result={result()} onDismiss={vi.fn()} />
    )
    const dialog = container.querySelector('dialog')
    expect(dialog?.open).toBe(true)

    rerender(
      <CodexRestartDialog result={result({ message: 'Set them again.' })} onDismiss={vi.fn()} />
    )
    expect(container.querySelector('dialog')?.open).toBe(true)
  })

  it('dismisses', () => {
    const onDismiss = vi.fn()
    render(<CodexRestartDialog result={result()} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('Got it'))
    expect(onDismiss).toHaveBeenCalled()
  })
})
