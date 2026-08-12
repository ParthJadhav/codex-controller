import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  gestureLabels,
  type ControllerBinding,
  type MappingProfile,
  type ProfileLibrary
} from '@shared/contracts'
import { createDefaultProfile } from '@shared/defaultProfile'
import { profileLimits } from '@shared/profileLimits'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { MappingsView } from './MappingsView'
import { TooltipProvider } from './ui/tooltip'

const binding = (update: Partial<ControllerBinding> = {}): ControllerBinding => ({
  id: 'binding-1',
  input: 'buttonA',
  gesture: 'tap',
  layer: 'base',
  action: { type: 'primaryClick', title: 'Approve' },
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  isEnabled: true,
  ...update
})

const model = (
  bindings: ControllerBinding[],
  update: Partial<ControllerAppModel> = {}
): ControllerAppModel => {
  const profile: MappingProfile = { ...createDefaultProfile(), bindings }
  const library: ProfileLibrary = {
    schemaVersion: 1,
    activeProfileId: profile.id,
    profiles: [profile]
  }
  return {
    activeProfile: profile,
    library,
    activeLayer: 'base',
    selectedBinding: null,
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

const show = (bindings: ControllerBinding[], update: Partial<ControllerAppModel> = {}): void => {
  render(
    <TooltipProvider>
      <MappingsView model={model(bindings, update)} />
    </TooltipProvider>
  )
}

const search = (query: string): void => {
  fireEvent.change(screen.getByLabelText('Search mappings'), { target: { value: query } })
}

describe('the empty state', () => {
  /** The state right after deleting the last mapping. Nothing was searched. */
  it('does not blame the search box for a library with no mappings', () => {
    show([])
    expect(screen.getByText(/No mappings yet/)).toBeTruthy()
    expect(screen.queryByText(/No mappings match/)).toBeNull()
  })

  it('blames the search only when there is a search', () => {
    show([binding()])
    search('nothing matches this')
    expect(screen.getByText(/No mappings match/)).toBeTruthy()
    expect(screen.queryByText(/No mappings yet/)).toBeNull()
  })

  it('says nothing about emptiness while mappings are listed', () => {
    show([binding()])
    expect(screen.queryByText(/No mappings/)).toBeNull()
  })
})

describe('mapping count boundary', () => {
  it('disables Add mapping at the persistence cap', () => {
    show(
      Array.from({ length: profileLimits.bindings }, (_, index) =>
        binding({ id: `binding-${index}` })
      )
    )

    expect((screen.getByLabelText('Add mapping') as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables profile import at the library cap', () => {
    const profiles = Array.from({ length: profileLimits.profiles }, (_, index) => ({
      ...createDefaultProfile(),
      id: `profile-${index}`,
      name: `Profile ${index + 1}`
    }))
    const active = profiles[0]!
    show(active.bindings, {
      activeProfile: active,
      library: {
        schemaVersion: 1,
        activeProfileId: active.id,
        profiles
      }
    })

    expect((screen.getByLabelText('Import profile') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('gesture labels', () => {
  it('names a rotation gesture instead of printing its id', () => {
    show([binding({ gesture: 'rotateClockwise', action: { type: 'primaryClick', title: 'Scroll' } })])
    expect(screen.getByText('Rotate clockwise')).toBeTruthy()
    expect(screen.queryByText('rotateClockwise')).toBeNull()
  })

  it('finds a mapping by the label the row shows', () => {
    show([
      binding({ gesture: 'rotateClockwise', action: { type: 'primaryClick', title: 'Scroll' } }),
      binding({ id: 'binding-2', input: 'buttonB', action: { type: 'primaryClick', title: 'Decline' } })
    ])
    search('rotate')
    expect(screen.getByText('Scroll')).toBeTruthy()
    expect(screen.queryByText('Decline')).toBeNull()
  })

  it('still finds a mapping by the gesture id a profile file stores', () => {
    show([binding({ gesture: 'doubleTap' })])
    search('doubleTap')
    expect(screen.getByText('Approve')).toBeTruthy()
  })

  it('takes its labels from the shared map, so no gesture can go unnamed', () => {
    expect(gestureLabels.rotateCounterClockwise).toBe('Rotate counterclockwise')
    show([binding({ gesture: 'holdBegan' })])
    expect(screen.getByText(gestureLabels.holdBegan)).toBeTruthy()
  })
})

/**
 * Regression: "Reset mappings to defaults" replaces the *whole library* — every
 * profile, not the list on screen — and autosave makes that permanent 600 ms
 * later. It sat one click away from Import and Export with no confirmation and
 * no undo.
 */
describe('resetting to defaults', () => {
  const twoProfiles = (): Partial<ControllerAppModel> => {
    const first: MappingProfile = { ...createDefaultProfile(), bindings: [binding()] }
    const second: MappingProfile = {
      ...createDefaultProfile(),
      id: 'profile-2',
      name: 'Second',
      bindings: [binding({ id: 'binding-2' }), binding({ id: 'binding-3' })]
    }
    return {
      activeProfile: first,
      library: { schemaVersion: 1, activeProfileId: first.id, profiles: [first, second] }
    }
  }

  it('does not destroy anything on the first click', () => {
    const resetToDefaults = vi.fn()
    show([binding()], { resetToDefaults })
    fireEvent.click(screen.getByLabelText('Reset mappings to defaults'))
    expect(resetToDefaults).not.toHaveBeenCalled()
  })

  it('names how much of the library goes', () => {
    show([binding()], { ...twoProfiles(), resetToDefaults: vi.fn() })
    fireEvent.click(screen.getByLabelText('Reset mappings to defaults'))
    const prompt = screen.getByText(/This removes/)
    expect(prompt.textContent).toMatch(/2 profiles/)
    expect(prompt.textContent).toMatch(/3 mappings/)
    expect(prompt.textContent).toMatch(/cannot be undone/)
  })

  it('resets once, and only once the user confirms', () => {
    const resetToDefaults = vi.fn()
    show([binding()], { resetToDefaults })
    fireEvent.click(screen.getByLabelText('Reset mappings to defaults'))
    fireEvent.click(screen.getByText('Reset to defaults'))
    expect(resetToDefaults).toHaveBeenCalledOnce()
  })

  it('leaves the library alone when the prompt is cancelled', () => {
    const resetToDefaults = vi.fn()
    show([binding()], { resetToDefaults })
    fireEvent.click(screen.getByLabelText('Reset mappings to defaults'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(resetToDefaults).not.toHaveBeenCalled()
    expect(screen.queryByText(/This removes/)).toBeNull()
  })
})
