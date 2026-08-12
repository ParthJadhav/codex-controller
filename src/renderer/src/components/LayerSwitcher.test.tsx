import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ControllerBinding,
  MappingLayer,
  MappingProfile,
  ProfileLibrary
} from '@shared/contracts'
import { createDefaultProfile } from '@shared/defaultProfile'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { LayerSwitcher } from './LayerSwitcher'
import { TooltipProvider } from './ui/tooltip'

const binding = (update: Partial<ControllerBinding> = {}): ControllerBinding => ({
  id: crypto.randomUUID(),
  input: 'buttonA',
  gesture: 'tap',
  layer: 'base',
  action: { type: 'primaryClick', title: 'Approve' },
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  isEnabled: true,
  ...update
})

const show = (
  bindings: ControllerBinding[],
  activeLayer: MappingLayer = 'base'
): { setActiveLayer: ReturnType<typeof vi.fn> } => {
  const profile: MappingProfile = { ...createDefaultProfile(), bindings }
  const library: ProfileLibrary = {
    schemaVersion: 1,
    activeProfileId: profile.id,
    profiles: [profile]
  }
  const setActiveLayer = vi.fn()
  const model = {
    activeProfile: profile,
    library,
    activeLayer,
    setActiveLayer
  } as unknown as ControllerAppModel
  render(
    <TooltipProvider>
      <LayerSwitcher model={model} />
    </TooltipProvider>
  )
  return { setActiveLayer }
}

const chipNames = (): string[] =>
  screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '')
    .filter((label) => label.includes('layer,'))

const chip = (layer: string): HTMLButtonElement =>
  screen.getByRole('button', { name: new RegExp(`^${layer} layer,`) }) as HTMLButtonElement

/**
 * A layer with no bindings is noise, but hiding the wrong one leaves the user
 * with nothing selected: a hardware layer-shift can activate a layer that has
 * no bindings yet, and Base is the fallback every unmatched gesture lands in.
 */
describe('LayerSwitcher chip visibility', () => {
  it('shows Base on its own for a profile that uses no other layer', () => {
    show([binding()])

    expect(chipNames()).toEqual(['Base layer, 1 mapping'])
  })

  it('shows Base even when nothing is bound in it', () => {
    show([binding({ layer: 'voice' })], 'base')

    expect(chipNames()).toContain('Base layer, 0 mappings')
  })

  it('shows a layer that has bindings of its own', () => {
    show([binding(), binding({ layer: 'review' }), binding({ layer: 'review' })])

    expect(chipNames()).toEqual(['Base layer, 1 mapping', 'Review layer, 2 mappings'])
  })

  it('hides a layer nothing is bound in and that is not live', () => {
    show([binding()])

    expect(screen.queryByRole('button', { name: /^Delivery layer/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Tasks layer/ })).toBeNull()
  })

  /** Hiding the live layer would leave the group with nothing selected. */
  it('shows the live layer even when it is empty', () => {
    show([binding()], 'tasks')

    expect(chipNames()).toEqual(['Base layer, 1 mapping', 'Tasks layer, 0 mappings'])
  })

  it('leaves an unassigned mapping out of the count', () => {
    show([
      binding({ layer: 'voice', action: { type: 'none', title: 'Unassigned' } }),
      binding({ layer: 'voice' })
    ])

    expect(chipNames()).toContain('Voice layer, 1 mapping')
  })

  it('hides a layer whose only mappings are unassigned', () => {
    show([binding(), binding({ layer: 'voice', action: { type: 'none', title: 'Unassigned' } })])

    expect(screen.queryByRole('button', { name: /^Voice layer/ })).toBeNull()
  })

  it('counts a disabled mapping, because it is still authored in that layer', () => {
    show([binding({ layer: 'review', isEnabled: false })])

    expect(chipNames()).toContain('Review layer, 1 mapping')
  })

  it('orders the chips the way the contract does, base first', () => {
    show([
      binding({ layer: 'general' }),
      binding({ layer: 'voice' }),
      binding({ layer: 'review' }),
      binding()
    ])

    expect(chipNames().map((label) => label.split(' layer')[0])).toEqual([
      'Base',
      'Voice',
      'Review',
      'General'
    ])
  })
})

describe('LayerSwitcher selection', () => {
  it('marks only the live layer as pressed', () => {
    show([binding(), binding({ layer: 'review' })], 'review')

    expect(chip('Review').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Review').dataset.selected).toBe('true')
    expect(chip('Base').getAttribute('aria-pressed')).toBe('false')
  })

  it('asks the model to switch when a chip is clicked', () => {
    const { setActiveLayer } = show([binding(), binding({ layer: 'review' })])

    fireEvent.click(chip('Review'))

    expect(setActiveLayer).toHaveBeenCalledWith('review')
  })

  it('groups the chips under one accessible name', () => {
    show([binding()])

    expect(screen.getByRole('group', { name: 'Mapping layer' })).toBeTruthy()
  })
})
