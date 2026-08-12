import { AlertTriangle, Check, LoaderCircle } from 'lucide-react'
import type { ControllerAppModel } from '../hooks/useControllerApp'

/**
 * "Saved" is the resting state of this app, and a resting state does not earn
 * colour. Only a failed or pending save is tinted, so the indicator reads as
 * background until it means something.
 */
export function AutosaveStatus({
  model,
  compact = false
}: {
  model: ControllerAppModel
  compact?: boolean
}): React.JSX.Element {
  const problem = model.autosaveState === 'invalid' || model.autosaveState === 'error'
  const busy = model.autosaveState === 'saving' || model.autosaveState === 'pending'
  const label = busy
    ? model.autosaveState === 'saving'
      ? 'Saving…'
      : 'Saving soon'
    : problem
      ? compact
        ? 'Not saved'
        : model.autosaveMessage
      : 'Saved'
  const Icon = busy ? LoaderCircle : problem ? AlertTriangle : Check

  return (
    <span
      className="autosave-status"
      data-state={model.autosaveState}
      data-tone={problem ? 'warning' : busy ? 'busy' : 'quiet'}
      role="status"
      aria-live="polite"
      title={model.autosaveMessage}
    >
      <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
