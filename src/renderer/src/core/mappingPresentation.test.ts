import { describe, expect, it } from 'vitest'
import type { ControllerBinding, MappingProfile } from '@shared/contracts'
import { createDefaultProfile } from '@shared/defaultProfile'
import { mappingConflicts } from './mappingResolver'
import {
  effectiveBindingsForLayer,
  effectiveConflictGroupsForLayer
} from './mappingPresentation'

const binding = (update: Partial<ControllerBinding> = {}): ControllerBinding => ({
  id: crypto.randomUUID(),
  input: 'buttonA',
  gesture: 'tap',
  layer: 'base',
  action: { type: 'primaryClick', title: 'Base action' },
  focusPolicy: 'neverFocus',
  safety: 'normal',
  isEnabled: true,
  ...update
})

const profile = (bindings: ControllerBinding[]): MappingProfile => ({
  ...createDefaultProfile(),
  bindings
})

describe('effective mapping presentation', () => {
  it('uses Base fallback and lets an enabled active-layer Nothing mapping mask it', () => {
    const base = binding({ id: 'base' })
    const target = profile([base])
    expect(effectiveBindingsForLayer(target, 'voice')).toEqual([base])

    const none = binding({
      id: 'none',
      layer: 'voice',
      action: { type: 'none', title: 'Unassigned' }
    })
    target.bindings.push(none)
    expect(effectiveBindingsForLayer(target, 'voice')).toEqual([none])
  })

  it('ignores a disabled active-layer mapping and falls back to Base', () => {
    const base = binding({ id: 'base' })
    const disabled = binding({ id: 'disabled', layer: 'voice', isEnabled: false })
    expect(effectiveBindingsForLayer(profile([base, disabled]), 'voice')).toEqual([base])
  })

  it('shows a Base conflict only while it is the effective fallback', () => {
    const first = binding({ id: 'base-1' })
    const second = binding({ id: 'base-2' })
    const target = profile([first, second])
    const baseGroups = mappingConflicts(target)

    expect(effectiveConflictGroupsForLayer(target, 'voice', baseGroups)).toEqual(baseGroups)

    target.bindings.push(
      binding({
        id: 'voice-none',
        layer: 'voice',
        action: { type: 'none', title: 'Unassigned' }
      })
    )
    expect(effectiveConflictGroupsForLayer(target, 'voice', baseGroups)).toEqual([])
  })

  it('does not surface a conflict from an unrelated layer', () => {
    const target = profile([
      binding({ id: 'review-1', layer: 'review' }),
      binding({ id: 'review-2', layer: 'review' })
    ])
    expect(
      effectiveConflictGroupsForLayer(target, 'voice', mappingConflicts(target))
    ).toEqual([])
  })
})
