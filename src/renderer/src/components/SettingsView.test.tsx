import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultProfile } from '@shared/defaultProfile'
import { createMicroCompanionProfile } from '@shared/microProfile'
import { profileLimits } from '@shared/profileLimits'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { SettingsView } from './SettingsView'

const settingsModel = (update: Partial<ControllerAppModel> = {}): ControllerAppModel => {
  const profile = createDefaultProfile()
  return {
    activeProfile: profile,
    library: { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] },
    controller: {
      connected: true,
      id: 'dualsense',
      name: 'DualSense Wireless Controller',
      productCategory: 'DualSense',
      transport: 'Bluetooth',
      batteryLevel: 0.6,
      supportsLight: true,
      supportsHaptics: true,
      touchpadPointerEnabled: true,
      touchpadPointerStatus: 'ready',
      capabilities: [],
      activeValues: {}
    },
    system: null,
    autosaveState: 'saved',
    autosaveMessage: 'All changes saved',
    isMicroCompanionProfile: false,
    microDialMode: null,
    codexBindingsConfirmed: [] as string[],
    setCodexBindingConfirmed: vi.fn(),
    codexKeymap: {
      path: '/tmp/keybindings.json',
      readable: true,
      entries: [
        {
          commandId: 'composer.increaseReasoningEffort',
          title: 'Increase reasoning effort',
          accelerator: 'Ctrl+Shift+.',
          state: 'set' as const,
          previous: null
        },
        {
          commandId: 'composer.decreaseReasoningEffort',
          title: 'Decrease reasoning effort',
          accelerator: 'Ctrl+Shift+,',
          state: 'set' as const,
          previous: null
        }
      ],
      conflicts: [],
      satisfied: false,
      unwritable: []
    },
    isApplyingCodexKeymap: false,
    applyCodexKeymap: vi.fn(),
    refreshCodexKeymap: vi.fn(),
    experimentalDualSenseMicrophoneEnabled: false,
    isSpeakerTestRunning: false,
    hasUnsavedChanges: false,
    addMicroCompanionProfile: vi.fn(),
    setMicroDialMode: vi.fn(),
    updateActiveProfile: vi.fn(),
    selectProfile: vi.fn(),
    duplicateProfile: vi.fn(),
    deleteActiveProfile: vi.fn(),
    importLibrary: vi.fn(),
    exportLibrary: vi.fn(),
    revertLibrary: vi.fn(),
    refreshSystem: vi.fn(),
    setExperimentalDualSenseMicrophoneEnabled: vi.fn(),
    verifyUSBControllerSpeaker: vi.fn(),
    ...update
  } as unknown as ControllerAppModel
}

describe('Micro companion settings', () => {
  it('offers the profile as something to add, not something already applied', () => {
    render(<SettingsView model={settingsModel()} />)
    expect(screen.getByText('Add Micro companion profile')).toBeTruthy()
    expect(screen.getByText(/Nothing you already have is replaced/)).toBeTruthy()
  })

  it('adds the profile on request', () => {
    const addMicroCompanionProfile = vi.fn()
    render(<SettingsView model={settingsModel({ addMicroCompanionProfile })} />)
    fireEvent.click(screen.getByText('Add Micro companion profile'))
    expect(addMicroCompanionProfile).toHaveBeenCalledOnce()
  })

  it('hides the dial control until the companion profile is the active one', () => {
    render(<SettingsView model={settingsModel()} />)
    expect(screen.queryByLabelText(/Dial mode/)).toBeNull()
  })

  it('shows the dial mode once the companion profile is active', () => {
    const micro = createMicroCompanionProfile()
    render(
      <SettingsView
        model={settingsModel({
          activeProfile: micro,
          library: { schemaVersion: 1, activeProfileId: micro.id, profiles: [micro] },
          isMicroCompanionProfile: true,
          microDialMode: 'reasoning'
        })}
      />
    )
    const select = screen.getByLabelText(/Dial mode/) as HTMLSelectElement
    expect(select.value).toBe('reasoning')
  })

  it('switches dial mode', () => {
    const setMicroDialMode = vi.fn()
    const micro = createMicroCompanionProfile()
    render(
      <SettingsView
        model={settingsModel({
          activeProfile: micro,
          library: { schemaVersion: 1, activeProfileId: micro.id, profiles: [micro] },
          isMicroCompanionProfile: true,
          microDialMode: 'reasoning',
          setMicroDialMode
        })}
      />
    )
    fireEvent.change(screen.getByLabelText(/Dial mode/), {
      target: { value: 'conversation-scroll' }
    })
    expect(setMicroDialMode).toHaveBeenCalledWith('conversation-scroll')
  })

  it('offers a Custom option rather than silently showing a mode the profile is not in', () => {
    const micro = createMicroCompanionProfile()
    render(
      <SettingsView
        model={settingsModel({
          activeProfile: micro,
          library: { schemaVersion: 1, activeProfileId: micro.id, profiles: [micro] },
          isMicroCompanionProfile: true,
          microDialMode: null
        })}
      />
    )
    expect(screen.getByText('Custom (edited)')).toBeTruthy()
  })

  it('labels the roles that only imitate Micro', () => {
    render(<SettingsView model={settingsModel()} />)
    expect(screen.getByText('Six status lights')).toBeTruthy()
    expect(screen.getAllByText('Approximate').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Exact after setup').length).toBeGreaterThan(0)
  })

  it('never offers model switching, which Codex exposes no command for', () => {
    render(<SettingsView model={settingsModel()} />)
    expect(screen.getByText(/no gesture is mapped to model\s+switching/)).toBeTruthy()
  })

  it('lets the user confirm they bound a command in Codex', () => {
    const setCodexBindingConfirmed = vi.fn()
    render(<SettingsView model={settingsModel({ setCodexBindingConfirmed })} />)
    fireEvent.click(
      screen.getByLabelText('I have bound Increase reasoning effort in Codex')
    )
    expect(setCodexBindingConfirmed).toHaveBeenCalledWith(
      'composer.increaseReasoningEffort',
      true
    )
  })

  it('reflects a binding the user already confirmed', () => {
    render(
      <SettingsView
        model={settingsModel({
          codexBindingsConfirmed: ['composer.increaseReasoningEffort']
        })}
      />
    )
    const toggle = screen.getByLabelText('I have bound Increase reasoning effort in Codex')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    const other = screen.getByLabelText('I have bound Decrease reasoning effort in Codex')
    expect(other.getAttribute('aria-checked')).toBe('false')
  })

  it('explains that a sent key is not proof Codex acted on it', () => {
    render(<SettingsView model={settingsModel()} />)
    expect(screen.getByText(/not that Codex acted on it/)).toBeTruthy()
  })

  it('lists the commands the installed build registers with no default binding', () => {
    render(<SettingsView model={settingsModel()} />)
    for (const title of ['Toggle Fast mode', 'Fork task', 'Toggle Plan mode']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
  })

  it('does not ask the user to bind a command Codex already binds', () => {
    // navigateForward ships bound to ⌘]; listing it would send the user to
    // configure a shortcut that already works.
    render(<SettingsView model={settingsModel()} />)
    expect(screen.queryByText('Navigate forward')).toBeNull()
  })




  it('reports a conflict instead of offering to steal the key', () => {
    render(
      <SettingsView
        model={settingsModel({
          codexKeymap: {
            path: '/tmp/keybindings.json',
            readable: true,
            entries: [],
            conflicts: [
              {
                commandId: 'composer.increaseReasoningEffort',
                title: 'Increase reasoning effort',
                accelerator: 'Ctrl+Shift+.',
                state: 'conflict' as const,
                previous: null,
                heldBy: 'toggleTerminal'
              }
            ],
            satisfied: false,
            unwritable: []
          }
        })}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('toggleTerminal')
  })


  /**
   * The complaint that prompted this: the button kept claiming Codex was set
   * up after a shortcut changed. These pin each state it can be in.
   */

  it('says what Codex currently has for a drifted shortcut', () => {
    render(
      <SettingsView
        model={settingsModel({
          codexKeymap: {
            path: '/tmp/keybindings.json',
            readable: true,
            entries: [
              {
                commandId: 'composer.increaseReasoningEffort',
                title: 'Increase reasoning effort',
                accelerator: 'Ctrl+Shift+.',
                state: 'set' as const,
                previous: 'Command+Shift+/'
              },
              {
                commandId: 'composer.decreaseReasoningEffort',
                title: 'Decrease reasoning effort',
                accelerator: 'Ctrl+Shift+,',
                state: 'alreadySet' as const,
                previous: 'Ctrl+Shift+,'
              }
            ],
            conflicts: [],
            satisfied: false,
            unwritable: []
          }
        })}
      />
    )
    expect(screen.getByText(/Codex has Command\+Shift\+\//)).toBeTruthy()
  })



  it('reports a shortcut it cannot express rather than writing a wrong one', () => {
    render(
      <SettingsView
        model={settingsModel({
          codexKeymap: {
            path: '/tmp/keybindings.json',
            readable: true,
            entries: [],
            conflicts: [],
            satisfied: false,
            unwritable: [
              {
                commandId: 'composer.increaseReasoningEffort',
                title: 'Increase reasoning effort',
                shortcut: { keyCode: 0x4c, keyDisplay: '⌤', modifiers: ['control'] }
              }
            ]
          }
        })}
      />
    )
    expect(screen.getByRole('alert').textContent).toMatch(/cannot be written/)
  })

})

/**
 * Regression: deleting a profile takes every mapping in it, autosave writes the
 * smaller library 600 ms later, and there is no undo. The button sat beside
 * Duplicate/Import/Export and fired on one click.
 */
describe('deleting a profile', () => {
  const twoProfiles = (): Partial<ControllerAppModel> => {
    const active = { ...createDefaultProfile(), name: 'Everyday' }
    const other = { ...createDefaultProfile(), id: 'profile-2', name: 'Second' }
    return {
      activeProfile: active,
      library: { schemaVersion: 1, activeProfileId: active.id, profiles: [active, other] }
    }
  }

  it('does not delete on the first click', () => {
    const deleteActiveProfile = vi.fn()
    render(<SettingsView model={settingsModel({ ...twoProfiles(), deleteActiveProfile })} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(deleteActiveProfile).not.toHaveBeenCalled()
  })

  it('names the profile and what goes with it', () => {
    const model = twoProfiles()
    render(<SettingsView model={settingsModel({ ...model, deleteActiveProfile: vi.fn() })} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText(/Delete .Everyday./)).toBeTruthy()
    const prompt = screen.getByText(/This removes/)
    expect(prompt.textContent).toMatch(
      new RegExp(`${model.activeProfile!.bindings.length} mappings`)
    )
    expect(prompt.textContent).toMatch(/leaving 1 profile\b/)
    expect(prompt.textContent).toMatch(/cannot be undone/)
  })

  it('deletes once the user confirms', () => {
    const deleteActiveProfile = vi.fn()
    render(<SettingsView model={settingsModel({ ...twoProfiles(), deleteActiveProfile })} />)
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete profile'))
    expect(deleteActiveProfile).toHaveBeenCalledOnce()
  })

  it('keeps the profile when the prompt is cancelled', () => {
    const deleteActiveProfile = vi.fn()
    render(<SettingsView model={settingsModel({ ...twoProfiles(), deleteActiveProfile })} />)
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(deleteActiveProfile).not.toHaveBeenCalled()
    expect(screen.queryByText(/This removes/)).toBeNull()
  })

  /**
   * The last profile cannot be deleted at all, so promising a deletion and
   * then refusing it would be a worse gate than no gate.
   */
  it('asks nothing about the last profile, which the model refuses anyway', () => {
    const deleteActiveProfile = vi.fn()
    render(<SettingsView model={settingsModel({ deleteActiveProfile })} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.queryByText(/This removes/)).toBeNull()
    expect(deleteActiveProfile).toHaveBeenCalledOnce()
  })
})

describe('profile persistence boundaries and setup copy', () => {
  it('ties the hold-to-dictate note to the shipped Create mapping', () => {
    const profile = createDefaultProfile()
    expect(
      profile.bindings.some(
        (binding) =>
          binding.input === 'view' &&
          binding.gesture === 'holdBegan' &&
          binding.action.type === 'holdShortcut' &&
          binding.action.codexCommandId === 'composer.startDictation'
      )
    ).toBe(true)

    render(<SettingsView model={settingsModel({ activeProfile: profile })} />)
    expect(screen.getByText(/default profile already maps Create/i)).toBeTruthy()
    expect(screen.getByText(/If you remove or replace it/i)).toBeTruthy()
  })

  it('disables profile-growing controls at the library cap', () => {
    const profiles = Array.from({ length: profileLimits.profiles }, (_, index) => ({
      ...createDefaultProfile(),
      id: `profile-${index}`,
      name: `Profile ${index + 1}`
    }))
    const active = profiles[0]!
    render(
      <SettingsView
        model={settingsModel({
          activeProfile: active,
          library: {
            schemaVersion: 1,
            activeProfileId: active.id,
            profiles
          }
        })}
      />
    )

    expect((screen.getByRole('button', { name: /Duplicate/ }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(
      (screen.getByRole('button', { name: /Import profile/ }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: /Add Micro companion profile/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })
})
