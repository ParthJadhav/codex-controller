import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  mappingLayerLabels,
  type ControllerBinding,
  type MappingProfile,
  type ProfileLibrary
} from '@shared/contracts'
import { codexCommands } from '@shared/codexCommands'
import { createDefaultProfile } from '@shared/defaultProfile'
import { profileLimits } from '@shared/profileLimits'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { profileAutosaveIssue } from '../core/profileAutosave'
import { resolveBinding } from '../core/mappingResolver'
import { LayerSwitcher } from './LayerSwitcher'
import { MappingInspector, ShortcutRecorder } from './MappingInspector'
import { MappingsView } from './MappingsView'
import { TooltipProvider } from './ui/tooltip'

const binding = (update: Partial<ControllerBinding> = {}): ControllerBinding => ({
  id: 'binding-1',
  input: 'buttonA',
  gesture: 'tap',
  layer: 'base',
  action: { type: 'keyboardShortcut', title: 'Send', shortcut: { keyCode: 36, keyDisplay: '↩', modifiers: [] } },
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  isEnabled: true,
  ...update
})

const inspectorModel = (
  update: Partial<ControllerAppModel> = {},
  profileBindings?: ControllerBinding[]
): ControllerAppModel => {
  const base = createDefaultProfile()
  const profile: MappingProfile = profileBindings
    ? { ...base, bindings: profileBindings }
    : base
  const library: ProfileLibrary = {
    schemaVersion: 1,
    activeProfileId: profile.id,
    profiles: [profile]
  }
  return {
    activeProfile: profile,
    library,
    activeLayer: 'base',
    selectedBinding: profileBindings?.[0] ?? null,
    conflicts: [],
    codexBindingsConfirmed: [] as string[],
    autosaveState: 'saved',
    autosaveMessage: 'All changes saved',
    hasUnsavedChanges: false,
    updateSelectedBinding: vi.fn(),
    revertLibrary: vi.fn(),
    testSelectedAction: vi.fn(),
    selectBinding: vi.fn(),
    deleteSelectedBinding: vi.fn(),
    addBinding: vi.fn(),
    importLibrary: vi.fn(),
    exportLibrary: vi.fn(),
    resetToDefaults: vi.fn(),
    setActiveLayer: vi.fn(),
    ...update
  } as unknown as ControllerAppModel
}

const optionLabels = (select: HTMLSelectElement): string[] =>
  [...select.options].map((option) => option.textContent ?? '')

describe('ShortcutRecorder', () => {
  const record = (
    init: Partial<KeyboardEventInit> & { code: string }
  ): { onChange: ReturnType<typeof vi.fn>; recorder: HTMLElement } => {
    const onChange = vi.fn()
    render(<ShortcutRecorder onChange={onChange} />)
    const recorder = screen.getByRole('button')
    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, init)
    return { onChange, recorder }
  }

  it('records one shortcut only after explicit activation', () => {
    const onChange = vi.fn()
    render(<ShortcutRecorder onChange={onChange} />)
    const recorder = screen.getByRole('button')

    fireEvent.keyDown(recorder, { key: 'R', code: 'KeyR', metaKey: true })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: 'R', code: 'KeyR', metaKey: true })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ keyDisplay: 'R', modifiers: ['command'] })
    )
    expect(recorder.getAttribute('aria-pressed')).toBe('false')
  })

  /**
   * The default profile binds Tab on R1. A recorder that always let Tab move
   * focus made that the one shipped shortcut nobody could re-record.
   */
  it('records Tab instead of leaving the recorder', () => {
    const { onChange } = record({ key: 'Tab', code: 'Tab' })
    expect(onChange).toHaveBeenCalledWith({ keyCode: 48, keyDisplay: '⇥', modifiers: [] })
  })

  it('still leaves recording on Escape without replacing the shortcut', () => {
    const onChange = vi.fn()
    render(
      <ShortcutRecorder
        shortcut={{ keyCode: 36, keyDisplay: '↩', modifiers: [] }}
        onChange={onChange}
      />
    )
    const recorder = screen.getByRole('button')
    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: 'Escape', code: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(recorder.getAttribute('aria-pressed')).toBe('false')
  })

  /**
   * `event.key` describes the user's layout, `event.code` the physical key the
   * bridge will post. On AZERTY the digit row types `&é"'`, so the two disagree.
   */
  it('derives the display from the physical key, not the layout character', () => {
    const { onChange } = record({ key: '&', code: 'Digit1' })
    expect(onChange).toHaveBeenCalledWith({ keyCode: 18, keyDisplay: '1', modifiers: [] })
  })

  it('names Space rather than recording an invisible blank', () => {
    const { onChange } = record({ key: ' ', code: 'Space' })
    expect(onChange).toHaveBeenCalledWith({ keyCode: 49, keyDisplay: 'Space', modifiers: [] })
  })

  /** Regression: a blank display read as "no shortcut" and wedged autosave. */
  it('records a Space shortcut the autosave validator accepts', () => {
    const { onChange } = record({ key: ' ', code: 'Space' })
    const shortcut = onChange.mock.calls[0][0]
    const profile = createDefaultProfile()
    const library: ProfileLibrary = {
      schemaVersion: 1,
      activeProfileId: profile.id,
      profiles: [
        {
          ...profile,
          bindings: [binding({ action: { type: 'keyboardShortcut', title: 'Play', shortcut } })]
        }
      ]
    }
    expect(profileAutosaveIssue(library)).toBeNull()
  })

  it('reports a key it cannot post instead of swallowing the press', () => {
    const { onChange } = record({ key: '1', code: 'Numpad1' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Numpad1')
    // Still recording, so the next key can be tried without another click.
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('states the modifier-only limitation in the help text', () => {
    const onChange = vi.fn()
    render(<ShortcutRecorder onChange={onChange} />)
    const recorder = screen.getByRole('button')
    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: 'Shift', code: 'ShiftLeft', shiftKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('A modifier on its own cannot be recorded')
  })

  it('does not bubble a recorded Command+digit to app-wide shortcuts', () => {
    const onChange = vi.fn()
    const bubbled = vi.fn()
    render(
      <div onKeyDown={bubbled}>
        <ShortcutRecorder onChange={onChange} />
      </div>
    )
    const recorder = screen.getByRole('button')
    fireEvent.click(recorder)

    fireEvent.keyDown(recorder, {
      key: '1',
      code: 'Digit1',
      metaKey: true
    })

    expect(onChange).toHaveBeenCalledOnce()
    expect(bubbled).not.toHaveBeenCalled()
  })
})

describe('mapping editor layers', () => {
  /** Regression: the editor's own label map had no voice entry, so voice read "Base". */
  it('shows a voice-layer binding as Voice', () => {
    const voice = binding({ layer: 'voice' })
    render(<MappingInspector model={inspectorModel({ selectedBinding: voice }, [voice])} />)
    const select = screen.getByLabelText(/In layer/) as HTMLSelectElement
    expect(select.value).toBe('voice')
    expect(select.selectedOptions[0].textContent).toBe('Voice')
  })

  it('offers Voice as a layer to hold', () => {
    const shift = binding({
      gesture: 'holdBegan',
      action: { type: 'layerShift', title: 'Hold Voice layer', targetLayer: 'voice' }
    })
    render(<MappingInspector model={inspectorModel({ selectedBinding: shift }, [shift])} />)
    const select = screen.getByLabelText(/Layer to hold/) as HTMLSelectElement
    expect(select.value).toBe('voice')
    expect(optionLabels(select)).toContain('Voice')
    // Base is what every layer already falls back to; holding it means nothing.
    expect(optionLabels(select)).not.toContain('Base')
  })

  it('labels the voice layer the same way in the browser and the switcher', () => {
    const voice = binding({ layer: 'voice', action: { type: 'primaryClick', title: 'Mute mic' } })
    const model = inspectorModel({ selectedBinding: voice }, [voice])
    const { unmount } = render(
      <TooltipProvider>
        <MappingsView model={model} />
      </TooltipProvider>
    )
    expect(screen.getByRole('heading', { name: /Voice/ })).toBeTruthy()
    unmount()

    render(
      <TooltipProvider>
        <LayerSwitcher model={model} />
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: /^Voice layer/ })).toBeTruthy()
    expect(mappingLayerLabels.voice).toBe('Voice')
  })
})

describe('chord bindings', () => {
  /** Regression: the select showed a default the model never held, so chords never fired. */
  it('persists a concrete second control when the gesture becomes a chord', () => {
    const updateSelectedBinding = vi.fn()
    const target = binding({ gesture: 'tap' })
    render(
      <MappingInspector
        model={inspectorModel({ selectedBinding: target, updateSelectedBinding }, [target])}
      />
    )
    fireEvent.change(screen.getByLabelText('Gesture'), { target: { value: 'chord' } })
    expect(updateSelectedBinding).toHaveBeenCalledWith(
      expect.objectContaining({ gesture: 'chord', secondaryInput: expect.any(String) })
    )
  })

  it('stores a chord that resolveBinding can match', () => {
    const updateSelectedBinding = vi.fn()
    const target = binding({ gesture: 'tap' })
    render(
      <MappingInspector
        model={inspectorModel({ selectedBinding: target, updateSelectedBinding }, [target])}
      />
    )
    fireEvent.change(screen.getByLabelText('Gesture'), { target: { value: 'chord' } })

    const stored = { ...target, ...updateSelectedBinding.mock.calls[0][0] } as ControllerBinding
    expect(stored.secondaryInput).toBeDefined()
    const profile = { ...createDefaultProfile(), bindings: [stored] }
    const resolved = resolveBinding(
      {
        kind: 'chord',
        input: stored.input,
        secondaryInput: stored.secondaryInput!,
        timestamp: 0
      },
      profile,
      'base'
    )
    expect(resolved).toBe(stored)
  })

  it('never pairs a control with itself', () => {
    const updateSelectedBinding = vi.fn()
    const target = binding({ input: 'buttonA', gesture: 'chord', secondaryInput: 'buttonB' })
    render(
      <MappingInspector
        model={inspectorModel({ selectedBinding: target, updateSelectedBinding }, [target])}
        showInputPicker
      />
    )
    fireEvent.change(screen.getByLabelText('Control'), { target: { value: 'buttonB' } })
    const update = updateSelectedBinding.mock.calls[0][0]
    expect(update.input).toBe('buttonB')
    expect(update.secondaryInput).not.toBe('buttonB')
  })
})

describe('pickable controls', () => {
  /** Regression: nothing produces `share`, so a binding on it can never fire. */
  it('does not offer the share input', () => {
    const target = binding({ gesture: 'chord', secondaryInput: 'buttonB' })
    render(
      <MappingInspector
        model={inspectorModel({ selectedBinding: target }, [target])}
        showInputPicker
      />
    )
    expect(optionLabels(screen.getByLabelText('Control') as HTMLSelectElement)).not.toContain(
      'Share (legacy)'
    )
    expect(
      optionLabels(screen.getByLabelText('Second control') as HTMLSelectElement)
    ).not.toContain('Share (legacy)')
  })
})

describe('Codex setup warning', () => {
  const increase = codexCommands.increaseReasoningEffort

  /** Regression: the editor checked the shortcut only, so re-recording hid the warning. */
  it('warns from the command id after the key has been re-recorded', () => {
    const target = binding({
      action: {
        type: 'keyboardShortcut',
        title: 'More reasoning effort',
        codexCommandId: increase.commandId,
        // A key Codex ships bound to something else entirely.
        shortcut: { keyCode: 0x2d, keyDisplay: 'N', modifiers: ['command'] }
      }
    })
    render(<MappingInspector model={inspectorModel({ selectedBinding: target }, [target])} />)
    expect(document.body.textContent).toContain(increase.title)
    expect(document.body.textContent).toContain('Codex has no shortcut bound to this yet')
  })

  it('warns from the shortcut alone when there is no command id', () => {
    const target = binding({
      action: { type: 'keyboardShortcut', title: 'More effort', shortcut: increase.shortcut }
    })
    render(<MappingInspector model={inspectorModel({ selectedBinding: target }, [target])} />)
    expect(document.body.textContent).toContain('Codex has no shortcut bound to this yet')
  })

  it('stops warning once the user has confirmed the Codex binding', () => {
    const target = binding({
      action: {
        type: 'keyboardShortcut',
        title: 'More reasoning effort',
        codexCommandId: increase.commandId,
        shortcut: increase.shortcut
      }
    })
    render(
      <MappingInspector
        model={inspectorModel(
          { selectedBinding: target, codexBindingsConfirmed: [increase.commandId] },
          [target]
        )}
      />
    )
    expect(document.body.textContent).not.toContain('Codex has no shortcut bound to this yet')
  })

  it('says nothing for a command Codex ships bound', () => {
    const target = binding({
      action: {
        type: 'keyboardShortcut',
        title: 'New task',
        codexCommandId: codexCommands.newTask.commandId,
        shortcut: codexCommands.newTask.shortcut
      }
    })
    render(<MappingInspector model={inspectorModel({ selectedBinding: target }, [target])} />)
    expect(document.body.textContent).not.toContain('Codex has no shortcut bound to this yet')
  })
})

/**
 * Regression: every field in the editor body is a controlled input whose only job
 * is to hand one patch to `updateSelectedBinding`. A field that sends the wrong
 * shape, or sends nothing, is an edit the user made and the app dropped — and
 * there is no Save button to notice it with.
 */
describe('mapping editor fields', () => {
  const editing = (
    target: ControllerBinding,
    props: { showInputPicker?: boolean } = {}
  ): ReturnType<typeof vi.fn> => {
    const updateSelectedBinding = vi.fn()
    render(
      <MappingInspector
        model={inspectorModel({ selectedBinding: target, updateSelectedBinding }, [target])}
        showInputPicker={props.showInputPicker}
      />
    )
    return updateSelectedBinding
  }

  it('shows an empty state rather than an editor when nothing is selected', () => {
    render(<MappingInspector model={inspectorModel({ selectedBinding: null })} />)

    expect(screen.queryByLabelText('Gesture')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Mapping editor' })).toBeTruthy()
  })

  it('names the editor after the control being edited', () => {
    editing(binding({ input: 'rightShoulder' }))

    expect(screen.getByRole('complementary', { name: 'R1 mapping' })).toBeTruthy()
  })

  it('sends only the gesture when the new gesture is not a chord', () => {
    const update = editing(binding({ gesture: 'tap' }))

    fireEvent.change(screen.getByLabelText('Gesture'), { target: { value: 'longPress' } })

    expect(update).toHaveBeenCalledWith({ gesture: 'longPress' })
  })

  it('leaves an existing second control alone when the gesture becomes a chord again', () => {
    const update = editing(binding({ gesture: 'tap', secondaryInput: 'buttonY' }))

    fireEvent.change(screen.getByLabelText('Gesture'), { target: { value: 'chord' } })

    expect(update).toHaveBeenCalledWith({ gesture: 'chord' })
  })

  it('sends the layer the mapping moved to', () => {
    const update = editing(binding({ layer: 'base' }))

    fireEvent.change(screen.getByLabelText(/In layer/), { target: { value: 'delivery' } })

    expect(update).toHaveBeenCalledWith({ layer: 'delivery' })
  })

  it('offers every layer the contract knows, base included', () => {
    editing(binding())

    expect(optionLabels(screen.getByLabelText(/In layer/) as HTMLSelectElement)).toEqual([
      'Base',
      'Voice',
      'Review',
      'Delivery',
      'Composer',
      'Tasks',
      'General'
    ])
  })

  it('sends the second control on its own', () => {
    const update = editing(binding({ gesture: 'chord', secondaryInput: 'buttonB' }))

    fireEvent.change(screen.getByLabelText('Second control'), { target: { value: 'buttonY' } })

    expect(update).toHaveBeenCalledWith({ secondaryInput: 'buttonY' })
  })

  it('hides the second control until the gesture is a chord', () => {
    editing(binding({ gesture: 'tap' }))

    expect(screen.queryByLabelText('Second control')).toBeNull()
  })

  it('sends the control on its own when it does not collide with the chord partner', () => {
    const update = editing(binding({ input: 'buttonA', gesture: 'chord', secondaryInput: 'buttonB' }), {
      showInputPicker: true
    })

    fireEvent.change(screen.getByLabelText('Control'), { target: { value: 'buttonX' } })

    expect(update).toHaveBeenCalledWith({ input: 'buttonX' })
  })

  it('hides the control picker unless the caller asks for it', () => {
    editing(binding())

    expect(screen.queryByLabelText('Control')).toBeNull()
  })

  /**
   * Switching what a mapping does replaces the action wholesale: keeping the
   * old fields around would leave, say, a `deepLinkURL` on a text insertion.
   */
  it('replaces the whole action when the action type changes', () => {
    const update = editing(binding())

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'textInsertion' } })

    expect(update).toHaveBeenCalledWith({
      action: { type: 'textInsertion', title: 'Insert text', text: '' }
    })
  })

  it('gives a new layer-shift action a target layer rather than an empty one', () => {
    const update = editing(binding())

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'layerShift' } })

    expect(update).toHaveBeenCalledWith({
      action: expect.objectContaining({ type: 'layerShift', targetLayer: expect.any(String) }),
      gesture: 'holdBegan'
    })
  })

  it('coerces a newly selected held shortcut to Start holding', () => {
    const update = editing(binding({ gesture: 'tap' }))

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'holdShortcut' } })

    expect(update).toHaveBeenCalledWith({
      action: expect.objectContaining({ type: 'holdShortcut' }),
      gesture: 'holdBegan'
    })
  })

  it('only offers hold semantics for a layer shift', () => {
    editing(
      binding({
        gesture: 'holdBegan',
        action: { type: 'layerShift', title: 'Hold', targetLayer: 'review' }
      })
    )

    expect(optionLabels(screen.getByLabelText('Gesture') as HTMLSelectElement)).toEqual([
      'Start holding'
    ])
  })

  it('sends the renamed action with the rest of the action intact', () => {
    const target = binding({
      action: { type: 'openWebURL', title: 'Docs', deepLinkURL: 'https://example.com' }
    })
    const update = editing(target)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Handbook' } })

    expect(update).toHaveBeenCalledWith({
      action: { type: 'openWebURL', title: 'Handbook', deepLinkURL: 'https://example.com' }
    })
  })

  /** A keyboard shortcut is named by its keys, so the editor does not ask twice. */
  it('does not offer a name for a plain keyboard shortcut', () => {
    editing(binding())

    expect(screen.queryByLabelText(/^Name/)).toBeNull()
  })

  it('sends the URL as the user types it', () => {
    const target = binding({
      action: { type: 'openWebURL', title: 'Docs', deepLinkURL: 'https://' }
    })
    const update = editing(target)

    fireEvent.change(screen.getByLabelText('Web address'), {
      target: { value: 'https://example.com/docs' }
    })

    expect(update).toHaveBeenCalledWith({
      action: expect.objectContaining({ deepLinkURL: 'https://example.com/docs' })
    })
  })

  it('labels the URL field for what the action means by it', () => {
    const { unmount } = render(
      <MappingInspector
        model={inspectorModel(
          {
            selectedBinding: binding({
              action: { type: 'deepLink', title: 'Open', deepLinkURL: 'codex://threads/new' }
            })
          },
          [binding()]
        )}
      />
    )
    expect(screen.getByLabelText('Codex URL')).toBeTruthy()
    unmount()

    render(
      <MappingInspector
        model={inspectorModel(
          {
            selectedBinding: binding({
              action: { type: 'openWebURL', title: 'Open', deepLinkURL: 'https://' }
            })
          },
          [binding()]
        )}
      />
    )
    expect(screen.getByLabelText('Web address')).toBeTruthy()
  })

  it('sends the layer a layer-shift action holds', () => {
    const update = editing(
      binding({
        gesture: 'holdBegan',
        action: { type: 'layerShift', title: 'Hold', targetLayer: 'review' }
      })
    )

    fireEvent.change(screen.getByLabelText(/Layer to hold/), { target: { value: 'tasks' } })

    expect(update).toHaveBeenCalledWith({
      action: { type: 'layerShift', title: 'Hold', targetLayer: 'tasks' }
    })
  })

  it('sends the text a text insertion types', () => {
    const update = editing(
      binding({ action: { type: 'textInsertion', title: 'Insert', text: '' } })
    )

    fireEvent.change(screen.getByLabelText('Text to type'), { target: { value: 'hello' } })

    expect(update).toHaveBeenCalledWith({
      action: { type: 'textInsertion', title: 'Insert', text: 'hello' }
    })
  })

  it('applies repository maxima to editable action fields', () => {
    const { unmount } = render(
      <MappingInspector
        model={inspectorModel({
          selectedBinding: binding({
            action: { type: 'openWebURL', title: 'Open', deepLinkURL: 'https://a.test/' }
          })
        })}
      />
    )
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).maxLength).toBe(
      profileLimits.actionTitle
    )
    expect((screen.getByLabelText('Web address') as HTMLInputElement).maxLength).toBe(
      profileLimits.url
    )
    unmount()

    editing(
      binding({ action: { type: 'textInsertion', title: 'Insert', text: '' } })
    )
    expect((screen.getByLabelText('Text to type') as HTMLTextAreaElement).maxLength).toBe(
      profileLimits.text
    )
  })

  it('disables sequence growth at the repository step cap', () => {
    const steps = Array.from({ length: profileLimits.sequenceSteps }, (_, index) => ({
      id: `step-${index}`,
      delayMilliseconds: 0,
      action: {
        type: 'keyboardShortcut' as const,
        title: `Step ${index + 1}`,
        shortcut: { keyCode: 36, keyDisplay: '↩', modifiers: [] }
      },
      focusPolicy: 'neverFocus' as const,
      safety: 'normal' as const
    }))
    editing(
      binding({
        action: { type: 'sequence', title: 'Full sequence', sequenceSteps: steps }
      })
    )

    expect((screen.getByRole('button', { name: 'Add step' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('sends the focus policy on its own', () => {
    const update = editing(binding({ focusPolicy: 'focusIfNeeded' }))

    fireEvent.change(screen.getByLabelText(/Window focus/), { target: { value: 'neverFocus' } })

    expect(update).toHaveBeenCalledWith({ focusPolicy: 'neverFocus' })
  })

  it('sends the safety level on its own', () => {
    const update = editing(binding({ safety: 'normal' }))

    fireEvent.change(screen.getByLabelText(/Confirmation/), {
      target: { value: 'consequential' }
    })

    expect(update).toHaveBeenCalledWith({ safety: 'consequential' })
  })

  it('sends the enabled flag both ways', () => {
    const update = editing(binding({ isEnabled: true }))

    fireEvent.click(screen.getByLabelText('Mapping enabled'))

    expect(update).toHaveBeenCalledWith({ isEnabled: false })
  })

  it('shows the values the binding already holds rather than a plausible default', () => {
    editing(
      binding({
        gesture: 'doubleTap',
        layer: 'voice',
        focusPolicy: 'neverFocus',
        safety: 'consequential',
        isEnabled: false
      })
    )

    expect((screen.getByLabelText('Gesture') as HTMLSelectElement).value).toBe('doubleTap')
    expect((screen.getByLabelText(/In layer/) as HTMLSelectElement).value).toBe('voice')
    expect((screen.getByLabelText(/Window focus/) as HTMLSelectElement).value).toBe('neverFocus')
    expect((screen.getByLabelText(/Confirmation/) as HTMLSelectElement).value).toBe(
      'consequential'
    )
    expect(screen.getByLabelText('Mapping enabled').getAttribute('aria-checked')).toBe('false')
  })

  it('says when the mapping collides with another one', () => {
    const target = binding()
    render(
      <MappingInspector
        model={inspectorModel({ selectedBinding: target, conflicts: [[target, binding({ id: 'other' })]] }, [
          target
        ])}
      />
    )

    expect(screen.getByText('Conflicts with another mapping')).toBeTruthy()
  })

  it('stays quiet about conflicts this mapping is not part of', () => {
    const target = binding()
    render(
      <MappingInspector
        model={inspectorModel(
          {
            selectedBinding: target,
            conflicts: [[binding({ id: 'x' }), binding({ id: 'y' })]]
          },
          [target]
        )}
      />
    )

    expect(screen.queryByText('Conflicts with another mapping')).toBeNull()
  })
})
