import { memo, useId, useState } from 'react'
import { AlertTriangle, Keyboard, MousePointerClick, Play, Plus, Trash2, Undo2 } from 'lucide-react'
import {
  gestureLabels,
  inputDisplayNames,
  mappingLayerIds,
  mappingLayerLabels,
  pickableControllerInputIds,
  type ActionSequenceStep,
  type ActionType,
  type ControllerInputId,
  type GestureKind,
  type KeyboardShortcut,
  type MappedAction,
  type ShortcutModifier
} from '@shared/contracts'
import { profileLimits } from '@shared/profileLimits'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { useSuspendControllerInput } from '../hooks/useSuspendControllerInput'
import { unacknowledgedCodexCommand } from '@shared/codexCommands'
import { keyDisplayForCode, macosKeyCodeFor } from '../core/macosKeyCodes'
import { formatShortcut } from '../core/shortcutDisplay'
import { AutosaveStatus } from './AutosaveStatus'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'
import { Switch } from './ui/switch'
import { Textarea } from './ui/textarea'

const actionLabels: Record<ActionType, string> = {
  none: 'Nothing',
  deepLink: 'Open a Codex link',
  keyboardShortcut: 'Press a keyboard shortcut',
  holdShortcut: 'Hold a keyboard shortcut',
  textInsertion: 'Type some text',
  openWebURL: 'Open a web page',
  primaryClick: 'Click the primary mouse button',
  layerShift: 'Switch mapping layer',
  sequence: 'Run a sequence of actions'
}

/**
 * A momentary shift to base is a no-op — base is what every layer falls back to
 * — so it is the one layer the "layer to hold" picker leaves out.
 */
const shiftableLayerIds = mappingLayerIds.filter((layer) => layer !== 'base')

/**
 * The control a chord pairs with, when the user has not chosen one.
 *
 * A chord needs both halves recorded to resolve at all, so the picker cannot
 * merely *look* set: the select used to fall back to `buttonB` for display while
 * the model kept `undefined`, and a chord in that state matched nothing. Any
 * concrete control other than the binding's own is a valid default.
 */
const defaultSecondaryInput = (input: ControllerInputId): ControllerInputId =>
  pickableControllerInputIds.find((candidate) => candidate !== input) ?? 'buttonB'

const defaultAction = (type: ActionType): MappedAction => {
  switch (type) {
    case 'deepLink':
      return { type, title: 'Open Codex task', deepLinkURL: 'codex://threads/new' }
    case 'openWebURL':
      return { type, title: 'Open web URL', deepLinkURL: 'https://' }
    case 'keyboardShortcut':
      return {
        type,
        title: 'Keyboard shortcut',
        shortcut: { keyCode: 36, keyDisplay: '↩', modifiers: [] }
      }
    case 'textInsertion':
      return { type, title: 'Insert text', text: '' }
    case 'holdShortcut':
      return {
        type,
        title: 'Held shortcut',
        shortcut: { keyCode: 2, keyDisplay: 'D', modifiers: ['control', 'option', 'shift'] }
      }
    case 'primaryClick':
      return { type, title: 'Primary mouse click' }
    case 'layerShift':
      return { type, title: 'Momentary layer', targetLayer: 'review' }
    case 'sequence':
      return {
        type,
        title: 'Action sequence',
        sequenceSteps: [
          {
            id: crypto.randomUUID(),
            delayMilliseconds: 0,
            action: { type: 'deepLink', title: 'New task', deepLinkURL: 'codex://threads/new' },
            focusPolicy: 'neverFocus',
            safety: 'normal'
          }
        ]
      }
    case 'none':
      return { type, title: 'Unassigned' }
  }
}

const shortcutModifiers = (event: React.KeyboardEvent): ShortcutModifier[] => [
  ...(event.metaKey ? (['command'] as const) : []),
  ...(event.altKey ? (['option'] as const) : []),
  ...(event.ctrlKey ? (['control'] as const) : []),
  ...(event.shiftKey ? (['shift'] as const) : [])
]

export function ShortcutRecorder({
  shortcut,
  onChange
}: {
  shortcut?: KeyboardShortcut
  onChange: (shortcut: KeyboardShortcut) => void
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  /**
   * The key press Codex Controller could not turn into a shortcut, if the last one
   * was such a press. Numpad keys, F17–F20 and IntlBackslash have no macOS
   * virtual key code in our table, and the recorder used to return silently for
   * them — indistinguishable from a dead app.
   */
  const [unsupportedCode, setUnsupportedCode] = useState<string | null>(null)
  /**
   * A controller press while the recorder is listening must not also run the
   * mapping it is bound to — re-recording the key for "submit" would otherwise
   * submit whatever Codex has open.
   */
  useSuspendControllerInput(recording)
  const instructionsId = useId()
  const feedbackId = useId()
  const value = formatShortcut(shortcut)

  const stopRecording = (): void => {
    setRecording(false)
    setUnsupportedCode(null)
  }

  return (
    <div className="shortcut-recorder-field">
      <button
        type="button"
        className="shortcut-recorder"
        data-recording={recording}
        data-empty={!value}
        aria-pressed={recording}
        aria-label={
          recording
            ? 'Recording keyboard shortcut'
            : `Record keyboard shortcut${shortcut ? `, current ${shortcut.keyDisplay}` : ''}`
        }
        aria-describedby={`${instructionsId} ${feedbackId}`}
        onClick={() => (recording ? stopRecording() : setRecording(true))}
        onBlur={stopRecording}
        onKeyDown={(event) => {
          if (!recording) return
          // Recorded keys belong to this control, not the app-wide Command+1–4
          // section switcher listening on window.
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            stopRecording()
            return
          }
          // A press of a modifier alone carries no key to post, so it is not a
          // recordable shortcut; keep waiting for the key it modifies.
          if (['Meta', 'Alt', 'Control', 'Shift'].includes(event.key)) return
          // Everything else is consumed, Tab included: the default profile binds
          // Tab on R1, and a recorder that always let Tab move focus made that
          // the one shipped shortcut nobody could re-record.
          event.preventDefault()
          const keyCode = macosKeyCodeFor(event.code)
          const keyDisplay = keyDisplayForCode(event.code)
          if (keyCode === undefined || keyDisplay === undefined) {
            setUnsupportedCode(event.code || event.key)
            return
          }
          onChange({ keyCode, keyDisplay, modifiers: shortcutModifiers(event) })
          stopRecording()
        }}
      >
        <Keyboard size={15} strokeWidth={1.9} aria-hidden="true" />
        <kbd className="shortcut-recorder-value">
          {recording ? 'Press keys…' : value ?? 'No shortcut'}
        </kbd>
        <span className="shortcut-recorder-hint" aria-hidden="true">
          {recording ? 'Esc to stop' : 'Click to record'}
        </span>
        <span className="sr-only" id={instructionsId}>
          Activate to start recording, then press the shortcut. A modifier on its own cannot be
          recorded — the shortcut needs a key to go with it. Escape stops recording and leaves the
          shortcut as it was; while recording, every other key including Tab is captured.
        </span>
      </button>
      {/*
        Always mounted, empty when there is nothing to report: a live region
        that appears together with its text is announced unreliably, and CSS
        hides it while empty.
      */}
      <p className="field-note field-note-warning shortcut-recorder-feedback" id={feedbackId} role="status">
        {unsupportedCode
          ? `Codex Controller cannot post ${unsupportedCode} — macOS has no key code for that key. Press a different key, or Escape to stop recording.`
          : ''}
      </p>
    </div>
  )
}

function Field({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {description && <span className="field-description">{description}</span>}
    </label>
  )
}

/**
 * The editor's copy of the "nothing bound in Codex" warning.
 *
 * It has to be computed the same way the dispatch path computes it, from the
 * shortcut *and* the authoritative `codexCommandId`, and it has to respect the
 * same acknowledgements. Checking the shortcut alone made the two surfaces
 * disagree the moment the user re-recorded the key: dispatch still knew the
 * mapping meant "increase reasoning effort" and warned, while the editor
 * declared it fine.
 */
function CodexSetupNote({
  action,
  confirmedCodexCommandIds
}: {
  action: MappedAction
  confirmedCodexCommandIds: readonly string[]
}): React.JSX.Element | null {
  const needsSetup = unacknowledgedCodexCommand(action, confirmedCodexCommandIds)
  if (!needsSetup) return null
  return (
    <p className="field-note field-note-warning" role="status">
      Codex has no shortcut bound to this yet, so the press will do nothing. In Codex, press ⌘/ and
      give “{needsSetup.title}” this shortcut.
    </p>
  )
}

function ActionFields({
  action,
  onChange,
  confirmedCodexCommandIds = []
}: {
  action: MappedAction
  onChange: (action: MappedAction) => void
  confirmedCodexCommandIds?: readonly string[]
}): React.JSX.Element | null {
  switch (action.type) {
    case 'keyboardShortcut': {
      return (
        <>
          <ShortcutRecorder
            shortcut={action.shortcut}
            onChange={(shortcut) => onChange({ ...action, shortcut })}
          />
          <CodexSetupNote action={action} confirmedCodexCommandIds={confirmedCodexCommandIds} />
        </>
      )
    }
    case 'deepLink':
    case 'openWebURL':
      return (
        <Field label={action.type === 'deepLink' ? 'Codex URL' : 'Web address'}>
          <Input
            value={action.deepLinkURL ?? ''}
            maxLength={profileLimits.url}
            placeholder={action.type === 'deepLink' ? 'codex://…' : 'https://…'}
            onChange={(event) => onChange({ ...action, deepLinkURL: event.currentTarget.value })}
          />
        </Field>
      )
    case 'textInsertion':
      return (
        <Field label="Text to type">
          <Textarea
            rows={3}
            value={action.text ?? ''}
            maxLength={profileLimits.text}
            onChange={(event) => onChange({ ...action, text: event.currentTarget.value })}
          />
        </Field>
      )
    case 'layerShift':
      return (
        <Field
          label="Layer to hold"
          description="The layer stays active only while the control is held."
        >
          <NativeSelect
            value={action.targetLayer ?? 'review'}
            onChange={(event) =>
              onChange({
                ...action,
                targetLayer: event.currentTarget.value as MappedAction['targetLayer']
              })
            }
          >
            {shiftableLayerIds.map((layer) => (
              <option key={layer} value={layer}>
                {mappingLayerLabels[layer]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )
    case 'holdShortcut':
      return (
        <>
          <ShortcutRecorder
            shortcut={action.shortcut}
            onChange={(shortcut) => onChange({ ...action, shortcut })}
          />
          <CodexSetupNote action={action} confirmedCodexCommandIds={confirmedCodexCommandIds} />
          <p className="field-note">
            Holds the shortcut down for as long as the control is held. Use “Start holding”;
            Codex Controller remembers that press and always sends its matching release, including
            after a disconnect or window change.
          </p>
        </>
      )
    case 'primaryClick':
      return (
        <p className="field-note">
          Clicks the primary mouse button where the pointer already is. While the touchpad is
          driving the pointer it clicks by itself, so this mapping only takes over when touchpad
          pointer control is off.
        </p>
      )
    default:
      return null
  }
}

function SequenceFields({
  action,
  onChange,
  confirmedCodexCommandIds
}: {
  action: MappedAction
  onChange: (action: MappedAction) => void
  confirmedCodexCommandIds: readonly string[]
}): React.JSX.Element {
  const steps = action.sequenceSteps ?? []
  const updateStep = (index: number, update: Partial<ActionSequenceStep>): void => {
    onChange({
      ...action,
      sequenceSteps: steps.map((step, candidate) =>
        candidate === index ? { ...step, ...update } : step
      )
    })
  }
  return (
    <div className="sequence-editor">
      {steps.map((step, index) => (
        <div className="sequence-step" key={step.id}>
          <div className="sequence-step-heading">
            <span className="sequence-step-index">{index + 1}</span>
            <strong>{step.action.title || actionLabels[step.action.type]}</strong>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove step ${index + 1}`}
              disabled={steps.length === 1}
              onClick={() =>
                onChange({
                  ...action,
                  sequenceSteps: steps.filter((_, candidate) => candidate !== index)
                })
              }
            >
              <Trash2 size={13} />
            </Button>
          </div>
          <Field label="Does">
            <NativeSelect
              value={step.action.type}
              onChange={(event) =>
                updateStep(index, { action: defaultAction(event.currentTarget.value as ActionType) })
              }
            >
              {(['deepLink', 'keyboardShortcut', 'textInsertion', 'openWebURL'] as ActionType[]).map(
                (type) => (
                  <option key={type} value={type}>
                    {actionLabels[type]}
                  </option>
                )
              )}
            </NativeSelect>
          </Field>
          <Field label="Name">
            <Input
              value={step.action.title}
              maxLength={profileLimits.actionTitle}
              onChange={(event) =>
                updateStep(index, { action: { ...step.action, title: event.currentTarget.value } })
              }
            />
          </Field>
          <ActionFields
            action={step.action}
            onChange={(next) => updateStep(index, { action: next })}
            confirmedCodexCommandIds={confirmedCodexCommandIds}
          />
          <div className="field-pair">
            <Field label="Focus">
              <NativeSelect
                value={step.focusPolicy}
                onChange={(event) =>
                  updateStep(index, {
                    focusPolicy: event.currentTarget.value as ActionSequenceStep['focusPolicy']
                  })
                }
              >
                <option value="frontmostOnly">Frontmost only</option>
                <option value="focusIfNeeded">Focus Codex</option>
                <option value="neverFocus">Never focus</option>
              </NativeSelect>
            </Field>
            <Field label="Wait before (ms)">
              <Input
                type="number"
                min={0}
                max={profileLimits.sequenceStepDelayMilliseconds}
                step={50}
                value={step.delayMilliseconds}
                onChange={(event) =>
                  updateStep(index, { delayMilliseconds: Number(event.currentTarget.value) })
                }
              />
            </Field>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        className="full-width"
        disabled={steps.length >= profileLimits.sequenceSteps}
        onClick={() =>
          onChange({
            ...action,
            sequenceSteps: [
              ...steps,
              {
                id: crypto.randomUUID(),
                delayMilliseconds: 150,
                action: defaultAction('keyboardShortcut'),
                focusPolicy: 'focusIfNeeded',
                safety: 'normal'
              }
            ]
          })
        }
      >
        <Plus size={14} />
        Add step
      </Button>
    </div>
  )
}

function MappingInspectorComponent({
  model,
  showInputPicker = false
}: {
  model: ControllerAppModel
  /**
   * The controller workspace picks the control by clicking the 3D model, so a
   * duplicate input dropdown there would be a third way to set the same field.
   * The mappings list has no spatial picker, so it keeps one.
   */
  showInputPicker?: boolean
}): React.JSX.Element {
  const binding = model.selectedBinding

  if (!binding) {
    return (
      <aside className="binding-editor" aria-label="Mapping editor">
        <div className="binding-editor-empty">
          <MousePointerClick size={22} strokeWidth={1.5} aria-hidden="true" />
          <p>
            {showInputPicker
              ? 'Choose a mapping from the list to edit it.'
              : 'Click a control on the DualSense to edit what it does.'}
          </p>
        </div>
      </aside>
    )
  }

  const conflicting = model.conflicts.some((group) =>
    group.some((candidate) => candidate.id === binding.id)
  )
  const testable = binding.action.type !== 'none' && binding.action.type !== 'layerShift'
  const gestureOptions = Object.entries(gestureLabels).filter(([gesture]) => {
    if (binding.action.type === 'layerShift') return gesture === 'holdBegan'
    if (binding.action.type === 'holdShortcut') {
      return gesture === 'holdBegan' || gesture === 'holdEnded'
    }
    return true
  })

  return (
    <aside className="binding-editor" aria-label={`${inputDisplayNames[binding.input]} mapping`}>
      <header className="binding-editor-header">
        <h2>{inputDisplayNames[binding.input]}</h2>
        {conflicting && (
          <span className="binding-conflict" role="status">
            <AlertTriangle size={12} aria-hidden="true" />
            Conflicts with another mapping
          </span>
        )}
      </header>

      <div className="binding-editor-scroll">
        <div className="binding-editor-body">
          <section className="binding-clause" aria-labelledby="clause-when">
            <h3 id="clause-when">When you</h3>
            <Field label="Gesture">
              <NativeSelect
                value={binding.gesture}
                onChange={(event) => {
                  const gesture = event.currentTarget.value as GestureKind
                  // A chord that never had its second control chosen resolves
                  // against nothing, so choosing the gesture has to commit a
                  // real one rather than only showing a plausible default.
                  model.updateSelectedBinding(
                    gesture === 'chord' && !binding.secondaryInput
                      ? { gesture, secondaryInput: defaultSecondaryInput(binding.input) }
                      : { gesture }
                  )
                }}
              >
                {gestureOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            {showInputPicker && (
              <Field label="Control">
                <NativeSelect
                  value={binding.input}
                  onChange={(event) => {
                    const input = event.currentTarget.value as ControllerInputId
                    // A chord cannot pair a control with itself.
                    model.updateSelectedBinding(
                      binding.secondaryInput === input
                        ? { input, secondaryInput: defaultSecondaryInput(input) }
                        : { input }
                    )
                  }}
                >
                  {pickableControllerInputIds.map((input) => (
                    <option key={input} value={input}>
                      {inputDisplayNames[input]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}

            {binding.gesture === 'chord' && (
              <Field label="Second control">
                <NativeSelect
                  value={binding.secondaryInput ?? defaultSecondaryInput(binding.input)}
                  onChange={(event) =>
                    model.updateSelectedBinding({
                      secondaryInput: event.currentTarget.value as ControllerInputId
                    })
                  }
                >
                  {pickableControllerInputIds.map((input) =>
                    input === binding.input ? null : (
                      <option key={input} value={input}>
                        {inputDisplayNames[input]}
                      </option>
                    )
                  )}
                </NativeSelect>
              </Field>
            )}

            <Field
              label="In layer"
              description="Base is the fallback. Other layers only apply while that layer is held."
            >
              <NativeSelect
                value={binding.layer}
                onChange={(event) =>
                  model.updateSelectedBinding({
                    layer: event.currentTarget.value as typeof binding.layer
                  })
                }
              >
                {mappingLayerIds.map((layer) => (
                  <option key={layer} value={layer}>
                    {mappingLayerLabels[layer]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </section>

          <section className="binding-clause" aria-labelledby="clause-do">
            <h3 id="clause-do">Codex Controller will</h3>
            <Field label="Action">
              <NativeSelect
                value={binding.action.type}
                onChange={(event) => {
                  const type = event.currentTarget.value as ActionType
                  model.updateSelectedBinding({
                    action: defaultAction(type),
                    ...((type === 'holdShortcut' || type === 'layerShift') && {
                      gesture: 'holdBegan' as const
                    })
                  })
                }}
              >
                {Object.entries(actionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            {binding.action.type !== 'keyboardShortcut' && binding.action.type !== 'none' && (
              <Field label="Name" description="Shown in the mappings list and the action overlay.">
                <Input
                  value={binding.action.title}
                  maxLength={profileLimits.actionTitle}
                  onChange={(event) =>
                    model.updateSelectedBinding({
                      action: { ...binding.action, title: event.currentTarget.value }
                    })
                  }
                />
              </Field>
            )}

            {binding.action.type === 'sequence' ? (
              <SequenceFields
                action={binding.action}
                onChange={(action) => model.updateSelectedBinding({ action })}
                confirmedCodexCommandIds={model.codexBindingsConfirmed}
              />
            ) : (
              <ActionFields
                action={binding.action}
                onChange={(action) => model.updateSelectedBinding({ action })}
                confirmedCodexCommandIds={model.codexBindingsConfirmed}
              />
            )}
          </section>

          <details className="binding-advanced">
            <summary>Delivery and safety</summary>
            <div className="binding-advanced-body">
              <Field
                label="Window focus"
                description="Whether Codex Controller may bring Codex forward to deliver this action."
              >
                <NativeSelect
                  value={binding.focusPolicy}
                  onChange={(event) =>
                    model.updateSelectedBinding({
                      focusPolicy: event.currentTarget.value as typeof binding.focusPolicy
                    })
                  }
                >
                  <option value="frontmostOnly">Only when Codex is frontmost</option>
                  <option value="focusIfNeeded">Focus Codex if needed</option>
                  <option value="neverFocus">Never change focus</option>
                </NativeSelect>
              </Field>
              <Field
                label="Confirmation"
                description="Consequential actions ask for confirmation before they run."
              >
                <NativeSelect
                  value={binding.safety}
                  onChange={(event) =>
                    model.updateSelectedBinding({
                      safety: event.currentTarget.value as typeof binding.safety
                    })
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="consequential">Consequential</option>
                </NativeSelect>
              </Field>
              <div className="switch-row">
                <span>
                  <strong>Mapping enabled</strong>
                  <small>Turn off to keep the mapping without dispatching it.</small>
                </span>
                <Switch
                  aria-label="Mapping enabled"
                  checked={binding.isEnabled}
                  onCheckedChange={(checked) => model.updateSelectedBinding({ isEnabled: checked })}
                />
              </div>
            </div>
          </details>
        </div>
      </div>

      <footer className="binding-editor-footer">
        <Button
          type="button"
          variant="secondary"
          disabled={!testable}
          onClick={() => void model.testSelectedAction()}
        >
          <Play size={13} aria-hidden="true" />
          Test action
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!model.hasUnsavedChanges}
          onClick={model.revertLibrary}
        >
          <Undo2 size={14} aria-hidden="true" />
          Revert
        </Button>
        <AutosaveStatus model={model} compact />
      </footer>
    </aside>
  )
}

export const MappingInspector = memo(
  MappingInspectorComponent,
  (previous, next) =>
    previous.model.selectedBinding === next.model.selectedBinding &&
    previous.model.autosaveState === next.model.autosaveState &&
    previous.model.autosaveMessage === next.model.autosaveMessage &&
    previous.model.hasUnsavedChanges === next.model.hasUnsavedChanges &&
    previous.model.conflicts === next.model.conflicts &&
    previous.model.codexBindingsConfirmed === next.model.codexBindingsConfirmed &&
    previous.model.updateSelectedBinding === next.model.updateSelectedBinding &&
    previous.model.revertLibrary === next.model.revertLibrary &&
    previous.model.testSelectedAction === next.model.testSelectedAction &&
    previous.showInputPicker === next.showInputPicker
)
