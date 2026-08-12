import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from '@shared/defaultProfile'
import type { ControllerBinding } from '@shared/contracts'
import { mappingConflicts, resolveBinding } from './mappingResolver'

describe('mapping resolver', () => {
  it('prefers an active-layer binding over the base binding', () => {
    const profile = createDefaultProfile()
    const layered: ControllerBinding = {
      ...structuredClone(profile.bindings[0]),
      id: crypto.randomUUID(),
      layer: 'review',
      action: { type: 'none', title: 'Review-only' }
    }
    profile.bindings.push(layered)
    const resolved = resolveBinding(
      { input: layered.input, kind: layered.gesture, timestamp: 1 },
      profile,
      'review'
    )
    expect(resolved?.id).toBe(layered.id)
  })

  it('matches chords independent of button order', () => {
    const profile = createDefaultProfile()
    const chord: ControllerBinding = {
      ...structuredClone(profile.bindings[0]),
      id: crypto.randomUUID(),
      input: 'buttonA',
      secondaryInput: 'buttonB',
      gesture: 'chord'
    }
    profile.bindings = [chord]
    expect(
      resolveBinding(
        { input: 'buttonB', secondaryInput: 'buttonA', kind: 'chord', timestamp: 1 },
        profile,
        'base'
      )?.id
    ).toBe(chord.id)
  })

  it('never resolves a disabled binding', () => {
    const profile = createDefaultProfile()
    const binding = profile.bindings[0]
    profile.bindings = [{ ...structuredClone(binding), isEnabled: false }]

    expect(
      resolveBinding({ input: binding.input, kind: binding.gesture, timestamp: 1 }, profile, 'base')
    ).toBeNull()
  })

  it('skips a disabled layer binding and falls through to the enabled base one', () => {
    const profile = createDefaultProfile()
    const base: ControllerBinding = {
      ...structuredClone(profile.bindings[0]),
      id: 'base-binding',
      layer: 'base',
      isEnabled: true,
      action: { type: 'none', title: 'Base' }
    }
    const layered: ControllerBinding = {
      ...base,
      id: 'review-binding',
      layer: 'review',
      isEnabled: false,
      action: { type: 'none', title: 'Review-only' }
    }
    profile.bindings = [layered, base]

    expect(
      resolveBinding({ input: base.input, kind: base.gesture, timestamp: 1 }, profile, 'review')?.id
    ).toBe('base-binding')
  })

  /**
   * Base is the fallback every unmatched gesture resolves to: a layer that
   * binds nothing for this control must not swallow the press.
   */
  it('falls through to base when the active layer binds nothing for the control', () => {
    const profile = createDefaultProfile()
    const base: ControllerBinding = {
      ...structuredClone(profile.bindings[0]),
      id: 'base-binding',
      layer: 'base',
      isEnabled: true
    }
    // A binding in the active layer, but on a different control entirely.
    const elsewhere: ControllerBinding = {
      ...base,
      id: 'elsewhere',
      layer: 'delivery',
      input: base.input === 'buttonA' ? 'buttonB' : 'buttonA'
    }
    profile.bindings = [elsewhere, base]

    expect(
      resolveBinding(
        { input: base.input, kind: base.gesture, timestamp: 1 },
        profile,
        'delivery'
      )?.id
    ).toBe('base-binding')
  })

  it('ignores a binding from a layer that is not the active one', () => {
    const profile = createDefaultProfile()
    const layered: ControllerBinding = {
      ...structuredClone(profile.bindings[0]),
      id: 'voice-binding',
      layer: 'voice',
      isEnabled: true
    }
    profile.bindings = [layered]

    expect(
      resolveBinding(
        { input: layered.input, kind: layered.gesture, timestamp: 1 },
        profile,
        'review'
      )
    ).toBeNull()
    expect(
      resolveBinding({ input: layered.input, kind: layered.gesture, timestamp: 1 }, profile, 'base')
    ).toBeNull()
  })

  it('resolves nothing when the control is bound under a different gesture', () => {
    const profile = createDefaultProfile()
    profile.bindings = [
      {
        ...structuredClone(profile.bindings[0]),
        id: 'tap-binding',
        input: 'buttonA',
        gesture: 'tap',
        layer: 'base',
        isEnabled: true
      }
    ]

    expect(
      resolveBinding({ input: 'buttonA', kind: 'longPress', timestamp: 1 }, profile, 'base')
    ).toBeNull()
    expect(
      resolveBinding({ input: 'buttonA', kind: 'tap', timestamp: 1 }, profile, 'base')?.id
    ).toBe('tap-binding')
  })

  describe('chords', () => {
    const chordProfile = (overrides: Partial<ControllerBinding> = {}) => {
      const profile = createDefaultProfile()
      profile.bindings = [
        {
          ...structuredClone(profile.bindings[0]),
          id: 'chord-binding',
          input: 'buttonA',
          secondaryInput: 'buttonB',
          gesture: 'chord',
          layer: 'base',
          isEnabled: true,
          ...overrides
        }
      ]
      return profile
    }

    it('never matches a chord binding that lost its second control', () => {
      const profile = chordProfile({ secondaryInput: undefined })

      expect(
        resolveBinding(
          { input: 'buttonA', secondaryInput: 'buttonB', kind: 'chord', timestamp: 1 },
          profile,
          'base'
        )
      ).toBeNull()
    })

    it('never matches a chord gesture that arrived without its second control', () => {
      const profile = chordProfile()

      expect(
        resolveBinding({ input: 'buttonA', kind: 'chord', timestamp: 1 }, profile, 'base')
      ).toBeNull()
    })

    it('does not match a chord gesture made on a different pair', () => {
      const profile = chordProfile()

      expect(
        resolveBinding(
          { input: 'buttonA', secondaryInput: 'buttonY', kind: 'chord', timestamp: 1 },
          profile,
          'base'
        )
      ).toBeNull()
    })

    it('resolves a layered chord ahead of the base chord on the same pair', () => {
      const profile = chordProfile()
      profile.bindings.push({
        ...structuredClone(profile.bindings[0]),
        id: 'layered-chord',
        layer: 'tasks'
      })

      expect(
        resolveBinding(
          { input: 'buttonB', secondaryInput: 'buttonA', kind: 'chord', timestamp: 1 },
          profile,
          'tasks'
        )?.id
      ).toBe('layered-chord')
    })
  })

  it('groups conflicting chords by their unordered pair', () => {
    const profile = createDefaultProfile()
    const chord: ControllerBinding = {
      ...structuredClone(profile.bindings[0]),
      id: 'chord-one',
      input: 'buttonA',
      secondaryInput: 'buttonB',
      gesture: 'chord',
      layer: 'base',
      isEnabled: true
    }
    profile.bindings = [
      chord,
      { ...chord, id: 'chord-two', input: 'buttonB', secondaryInput: 'buttonA' }
    ]

    const conflicts = mappingConflicts(profile)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].map((binding) => binding.id)).toEqual(['chord-one', 'chord-two'])
  })

  it('does not group two bindings on the same control in different layers', () => {
    const profile = createDefaultProfile()
    const binding = structuredClone(profile.bindings[0])
    profile.bindings = [
      { ...binding, id: 'in-base', layer: 'base', isEnabled: true },
      { ...binding, id: 'in-voice', layer: 'voice', isEnabled: true }
    ]

    expect(mappingConflicts(profile)).toHaveLength(0)
  })

  it('reports duplicate enabled gestures in the same layer', () => {
    const profile = createDefaultProfile()
    profile.bindings.push({
      ...structuredClone(profile.bindings[0]),
      id: crypto.randomUUID()
    })
    expect(mappingConflicts(profile)).toHaveLength(1)
    profile.bindings.at(-1)!.isEnabled = false
    expect(mappingConflicts(profile)).toHaveLength(0)
  })
})
