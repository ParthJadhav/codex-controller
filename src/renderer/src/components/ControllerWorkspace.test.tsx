import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ControllerBinding,
  MappingLayer,
  MappingProfile,
  ProfileLibrary
} from '@shared/contracts'
import { createDefaultProfile } from '@shared/defaultProfile'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { ControllerWorkspace } from './ControllerWorkspace'
import { TooltipProvider } from './ui/tooltip'

// The 3D stage needs a WebGL context jsdom does not have, and none of what this
// file asserts is drawn by it. The caption under it is the subject.
vi.mock('./DualSenseScene', () => ({
  DualSenseScene: () => <div data-testid="scene" />
}))

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
  activeLayer: MappingLayer = 'base'
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
    activeLayer,
    selectedInput: 'buttonA',
    selectedBinding: null,
    conflicts: [],
    allInputs: new Set(['buttonA']),
    codexBindingsConfirmed: [] as string[],
    autosaveState: 'saved',
    autosaveMessage: 'All changes saved',
    hasUnsavedChanges: false,
    controllerActiveValuesRef: { current: new Map() },
    subscribeActiveValues: () => () => undefined,
    selectInput: vi.fn(),
    deselectInput: vi.fn(),
    updateSelectedBinding: vi.fn(),
    revertLibrary: vi.fn(),
    testSelectedAction: vi.fn(),
    selectBinding: vi.fn(),
    setActiveLayer: vi.fn()
  } as unknown as ControllerAppModel
}

const show = (bindings: ControllerBinding[], activeLayer: MappingLayer = 'base'): void => {
  render(
    <TooltipProvider>
      <ControllerWorkspace model={model(bindings, activeLayer)} />
    </TooltipProvider>
  )
}

/**
 * Regression: the halo on the 3D model skips disabled bindings, so a caption that
 * read a disabled mapping out as though it were live contradicted the part it
 * was captioning.
 */
describe('StageCaption and disabled bindings', () => {
  it('presents a disabled mapping as unavailable when there is no fallback', () => {
    show([binding({ isEnabled: false })])
    expect(screen.getByText('Not mapped')).toBeTruthy()
    expect(screen.queryByText('Approve')).toBeNull()
  })

  it('leaves an enabled mapping unannotated', () => {
    show([binding()])
    expect(screen.getByText('Approve')).toBeTruthy()
    expect(screen.queryByText(/\(disabled\)/)).toBeNull()
  })

  /** The halo lights for the enabled one, so the caption reads that one out. */
  it('prefers an enabled mapping over a disabled one on the same control', () => {
    show([
      binding({ id: 'off', isEnabled: false, action: { type: 'primaryClick', title: 'Old job' } }),
      binding({ id: 'on', action: { type: 'primaryClick', title: 'Current job' } })
    ])
    expect(screen.getByText('Current job')).toBeTruthy()
    expect(screen.queryByText('Old job')).toBeNull()
    expect(screen.queryByText(/\(disabled\)/)).toBeNull()
  })

  it('names the gesture from the shared label map', () => {
    show([binding({ gesture: 'rotateCounterClockwise' })])
    expect(screen.getByText('Rotate counterclockwise')).toBeTruthy()
  })

  it('says a control with no mapping is not mapped', () => {
    show([binding({ input: 'buttonB' })])
    expect(screen.getByText('Not mapped')).toBeTruthy()
  })

  it('shows the Base action used as fallback in another layer', () => {
    show([binding({ action: { type: 'primaryClick', title: 'Base fallback' } })], 'voice')
    expect(screen.getByText('Base fallback')).toBeTruthy()
  })

  it('lets an active-layer Nothing action mask the Base action', () => {
    show(
      [
        binding({ id: 'base', action: { type: 'primaryClick', title: 'Base fallback' } }),
        binding({
          id: 'voice-none',
          layer: 'voice',
          action: { type: 'none', title: 'Unassigned' }
        })
      ],
      'voice'
    )
    expect(screen.getByText('Not mapped')).toBeTruthy()
    expect(screen.queryByText('Base fallback')).toBeNull()
  })
})
