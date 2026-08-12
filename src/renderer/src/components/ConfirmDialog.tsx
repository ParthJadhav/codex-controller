import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'

/**
 * The gate in front of an operation that destroys saved work.
 *
 * "Reset mappings to defaults" and "Delete profile" were one unconfirmed click
 * each, and autosave made the result permanent 600 ms later — there is no undo
 * and no second copy. The prompt has to name what is actually lost ("this
 * removes 3 profiles"), because the two buttons sit next to Import and Export
 * and the icon alone does not say how much of the library is at stake.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    // `showModal` gives focus trapping and a backdrop; a host without it must
    // still show the question rather than swallow it and leave the button dead.
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.open = true
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="app-dialog-body">
        <span className="app-dialog-icon" aria-hidden="true">
          <AlertTriangle size={18} strokeWidth={1.9} />
        </span>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p>{description}</p>
        <div className="app-dialog-actions">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
