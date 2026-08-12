import { useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import type { CodexKeymapWriteSnapshot } from '@shared/contracts'
import { Button } from './ui/button'

/**
 * Shown after Codex's keymap is rewritten.
 *
 * Codex reads `keybindings.json` without watching it, and the renderer caches
 * keymap state, so a running Codex can keep using the bindings it started with.
 * A user who presses the button, sees a success toast, and then finds the
 * shortcut still doing nothing has been told the operation worked when the part
 * they care about has not happened yet — which is the same failure mode this
 * whole feature was built to remove. Saying "restart Codex" plainly, once, is
 * cheaper than that confusion.
 */
export function CodexRestartDialog({
  result,
  onDismiss
}: {
  result: CodexKeymapWriteSnapshot | null
  onDismiss: () => void
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    // The `<dialog>` only exists while `result` does — clearing `result`
    // unmounts it, so there is never a mounted-but-resultless dialog to close.
    // The close half of this effect could not run and pretended otherwise.
    if (!dialog || dialog.open) return
    // `showModal` gives focus trapping and a backdrop, but a host without it
    // should still show the dialog rather than silently swallow the one
    // message that explains why the shortcut is not working yet.
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.open = true
  }, [result])

  if (!result) return null

  const applied = result.entries.filter((entry) => entry.state !== 'conflict')

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby="codex-restart-title"
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
      onClose={onDismiss}
    >
      <div className="app-dialog-body">
        <span className="app-dialog-icon" aria-hidden="true">
          <RefreshCw size={18} strokeWidth={1.9} />
        </span>
        <h2 id="codex-restart-title">Restart Codex to finish</h2>
        <p>
          The shortcuts are written, but Codex only reads its keymap at startup. Quit and reopen
          Codex, then the controls below will work.
        </p>

        {applied.length > 0 && (
          <dl className="app-dialog-facts">
            {applied.map((entry) => (
              <div key={entry.commandId}>
                <dt>{entry.title}</dt>
                <dd>
                  <kbd>{entry.accelerator}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <p className="app-dialog-note">
          Saved to {result.path}
          {result.backupPath ? '. Your previous file was backed up alongside it.' : '.'}
        </p>

        <div className="app-dialog-actions">
          <Button type="button" onClick={onDismiss}>
            Got it
          </Button>
        </div>
      </div>
    </dialog>
  )
}
