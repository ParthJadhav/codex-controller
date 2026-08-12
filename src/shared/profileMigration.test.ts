import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from './defaultProfile'
import { createMicroCompanionProfile, withMicroDialMode } from './microProfile'
import {
  currentLibrarySchemaVersion,
  currentProfileSchemaVersion,
  migrateProfileLibrary
} from './profileMigration'

/** The layout the app shipped before the D-pad became the arrow keys. */
const historicalShortcuts: Record<
  string,
  { keyCode: number; keyDisplay: string; modifiers: string[] }
> = {
  'buttonA|Send / activate': { keyCode: 0x24, keyDisplay: '↩', modifiers: [] },
  'buttonB|Escape / cancel': { keyCode: 0x35, keyDisplay: 'Esc', modifiers: [] },
  'buttonX|Toggle review': {
    keyCode: 0x05,
    keyDisplay: 'G',
    modifiers: ['control', 'shift']
  },
  'dpadLeft|Navigate back': { keyCode: 0x21, keyDisplay: '[', modifiers: ['command'] },
  'dpadRight|Navigate forward': { keyCode: 0x1e, keyDisplay: ']', modifiers: ['command'] },
  'dpadDown|Toggle sidebar': { keyCode: 0x0b, keyDisplay: 'B', modifiers: ['command'] },
  'dpadUp|Command menu': {
    keyCode: 0x23,
    keyDisplay: 'P',
    modifiers: ['command', 'shift']
  },
  'view|Search tasks': { keyCode: 0x05, keyDisplay: 'G', modifiers: ['command'] },
  'rightShoulder|Command menu': {
    keyCode: 0x28,
    keyDisplay: 'K',
    modifiers: ['command']
  },
  'leftStickClick|Toggle terminal': {
    keyCode: 0x32,
    keyDisplay: '`',
    modifiers: ['control']
  },
  'rightStickClick|Toggle bottom panel': {
    keyCode: 0x26,
    keyDisplay: 'J',
    modifiers: ['command']
  }
}

const historicalDeepLinks: Record<string, string> = {
  'buttonY|New task': 'codex://threads/new',
  'menu|Open Settings': 'codex://settings'
}

const supersededDefaultBindings = [
  ['buttonA', 'tap', 'keyboardShortcut', 'Send / activate'],
  ['buttonB', 'tap', 'keyboardShortcut', 'Escape / cancel'],
  ['buttonX', 'tap', 'keyboardShortcut', 'Toggle review'],
  ['buttonY', 'tap', 'deepLink', 'New task'],
  ['dpadLeft', 'tap', 'keyboardShortcut', 'Navigate back'],
  ['dpadRight', 'tap', 'keyboardShortcut', 'Navigate forward'],
  ['dpadDown', 'tap', 'keyboardShortcut', 'Toggle sidebar'],
  ['dpadUp', 'tap', 'keyboardShortcut', 'Command menu'],
  ['view', 'tap', 'keyboardShortcut', 'Search tasks'],
  ['menu', 'tap', 'deepLink', 'Open Settings'],
  ['leftShoulder', 'holdBegan', 'layerShift', 'Hold Review layer'],
  ['rightShoulder', 'tap', 'keyboardShortcut', 'Command menu'],
  ['leftTrigger', 'tap', 'voiceDictation', 'Toggle voice dictation'],
  ['leftTrigger', 'doubleTap', 'sendDictation', 'Send dictated message'],
  ['leftStickClick', 'tap', 'keyboardShortcut', 'Toggle terminal'],
  ['rightStickClick', 'tap', 'keyboardShortcut', 'Toggle bottom panel']
].map(([input, gesture, type, title], index) => {
  const shortcut = historicalShortcuts[`${input}|${title}`]
  const deepLinkURL = historicalDeepLinks[`${input}|${title}`]
  const focusPolicy =
    input === 'buttonA' || input === 'buttonB'
      ? 'frontmostOnly'
      : ['buttonY', 'menu', 'leftShoulder'].includes(input) ||
          type === 'voiceDictation'
        ? 'neverFocus'
        : 'focusIfNeeded'
  return {
    id: `superseded-${index}`,
    input,
    gesture,
    layer: 'base',
    action: {
      type,
      title,
      ...(shortcut ? { shortcut } : {}),
      ...(deepLinkURL ? { deepLinkURL } : {}),
      ...(type === 'layerShift' ? { targetLayer: 'review' } : {})
    },
    focusPolicy,
    safety: 'normal',
    isEnabled: true
  }
})

const libraryOf = (bindings: unknown[]): unknown => ({
  schemaVersion: 1,
  profiles: [{ schemaVersion: 4, id: 'saved', name: 'Codex', bindings }]
})

const migratedBindings = (library: unknown): Array<{ input: string; action: { type: string } }> =>
  (migrateProfileLibrary(library) as {
    profiles: Array<{ bindings: Array<{ input: string; action: { type: string } }> }>
  }).profiles[0].bindings

const legacyBinding = {
  id: 'legacy-voice',
  input: 'leftTrigger',
  gesture: 'tap',
  layer: 'base',
  action: {
    type: 'keyboardShortcut',
    title: 'Toggle dictation',
    shortcut: {
      keyCode: 2,
      modifiers: ['control', 'shift'],
      keyDisplay: 'D'
    }
  },
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  isEnabled: true
}

describe('adopting the current default layout', () => {
  const currentTypes = (bindings: Array<{ input: string; action: { type: string } }>) =>
    bindings.filter((binding) => binding.input === 'dpadUp').map((binding) => binding.action.type)

  it('replaces an untouched superseded default with the current mappings', () => {
    const bindings = migratedBindings(libraryOf(supersededDefaultBindings))

    expect(bindings.map((binding) => binding.action.type)).toEqual(
      createDefaultProfile().bindings.map((binding) => binding.action.type)
    )
    expect(currentTypes(bindings)).toEqual(['keyboardShortcut'])
    expect(bindings.some((binding) => binding.action.type === 'sequence')).toBe(false)
  })

  it('preserves empty bindings the editor creates because they are user changes', () => {
    const placeholders = ['touchpad', 'home'].map((input) => ({
      id: `placeholder-${input}`,
      input,
      gesture: 'tap',
      layer: 'base',
      action: { type: 'none', title: 'Unassigned' },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal',
      isEnabled: true
    }))
    const bindings = migratedBindings(libraryOf([...supersededDefaultBindings, ...placeholders]))

    expect(bindings).toHaveLength(supersededDefaultBindings.length + placeholders.length)
    expect(bindings.filter((binding) => binding.action.type === 'none')).toHaveLength(4)
    expect(bindings.some((binding) => binding.action.type === 'primaryClick')).toBe(false)
  })

  it('also adopts the layout that drove Codex Controller instead of Codex', () => {
    const shortcutFor = (input: string, title: string) => {
      const shortcuts: Record<string, { keyCode: number; keyDisplay: string; modifiers: string[] }> = {
        'dpadUp|Arrow up': { keyCode: 0x7e, keyDisplay: '↑', modifiers: [] },
        'dpadDown|Arrow down': { keyCode: 0x7d, keyDisplay: '↓', modifiers: [] },
        'dpadLeft|Arrow left': { keyCode: 0x7b, keyDisplay: '←', modifiers: [] },
        'dpadRight|Arrow right': { keyCode: 0x7c, keyDisplay: '→', modifiers: [] },
        'buttonA|Return': { keyCode: 0x24, keyDisplay: '↩', modifiers: [] },
        'buttonB|Escape': { keyCode: 0x35, keyDisplay: 'Esc', modifiers: [] }
      }
      return shortcuts[`${input}|${title}`]
    }
    const controlDeckLayout = [
      ['dpadUp', 'tap', 'keyboardShortcut', 'Arrow up'],
      ['dpadDown', 'tap', 'keyboardShortcut', 'Arrow down'],
      ['dpadLeft', 'tap', 'keyboardShortcut', 'Arrow left'],
      ['dpadRight', 'tap', 'keyboardShortcut', 'Arrow right'],
      ['buttonA', 'tap', 'keyboardShortcut', 'Return'],
      ['buttonB', 'tap', 'keyboardShortcut', 'Escape'],
      ['buttonX', 'tap', 'openProjectPicker', 'Open the project picker'],
      ['buttonY', 'tap', 'newTask', 'New task'],
      ['rightTrigger', 'tap', 'sendTask', 'Send or run the task'],
      ['view', 'tap', 'startDictation', 'Start voice capture'],
      ['view', 'longPress', 'stopDictation', 'Stop voice capture'],
      ['leftStickClick', 'rotateClockwise', 'cycleModel', 'Next model']
    ].map(([input, gesture, type, title], index) => {
      const shortcut = shortcutFor(input, title)
      return {
        id: `interim-${index}`,
        input,
        gesture,
        layer: 'base',
        action: { type, title, ...(shortcut ? { shortcut } : {}) },
        focusPolicy: 'focusIfNeeded',
        safety: 'normal',
        isEnabled: true
      }
    })

    const bindings = migratedBindings(libraryOf(controlDeckLayout))

    // Those action types no longer exist, so leaving them would fail validation.
    expect(bindings.map((binding) => binding.action.type)).toEqual(
      createDefaultProfile().bindings.map((binding) => binding.action.type)
    )
  })

  it('leaves a profile alone once any mapping is the user’s own', () => {
    const edited = [
      ...supersededDefaultBindings.slice(1),
      {
        ...supersededDefaultBindings[0],
        action: { type: 'openWebURL', title: 'My dashboard' }
      }
    ]
    const bindings = migratedBindings(libraryOf(edited))

    expect(bindings).toHaveLength(edited.length)
    expect(bindings.some((binding) => binding.action.type === 'openWebURL')).toBe(true)
    expect(bindings.some((binding) => binding.action.type === 'sequence')).toBe(false)
  })

  it('does not keep rewriting a profile that already holds the current layout', () => {
    const current = createDefaultProfile().bindings
    const bindings = migratedBindings(libraryOf(current))

    expect(bindings).toEqual(current)
  })

  it.each([
    {
      change: 'a disabled binding',
      edit: () =>
        createDefaultProfile().bindings.map((binding, index) =>
          index === 0 ? { ...binding, isEnabled: false } : binding
        )
    },
    {
      change: 'a deleted binding',
      edit: () => createDefaultProfile().bindings.slice(1)
    },
    {
      change: 'a reordered binding list',
      edit: () => {
        const current = createDefaultProfile().bindings
        return [current[1]!, current[0]!, ...current.slice(2)]
      }
    },
    {
      change: 'an edited focus policy',
      edit: () =>
        createDefaultProfile().bindings.map((binding, index) =>
          index === 0 ? { ...binding, focusPolicy: 'neverFocus' as const } : binding
        )
    },
    {
      change: 'an edited safety classification',
      edit: () =>
        createDefaultProfile().bindings.map((binding, index) =>
          index === 0 ? { ...binding, safety: 'consequential' as const } : binding
        )
    },
    {
      change: 'an added placeholder',
      edit: () => [
        ...createDefaultProfile().bindings,
        {
          id: 'my-placeholder',
          input: 'home' as const,
          gesture: 'tap' as const,
          layer: 'base' as const,
          action: { type: 'none' as const, title: 'Unassigned' },
          focusPolicy: 'focusIfNeeded' as const,
          safety: 'normal' as const,
          isEnabled: true
        }
      ]
    }
  ])('preserves $change instead of adopting stock again', ({ edit }) => {
    const edited = edit()
    expect(migratedBindings(libraryOf(edited))).toEqual(edited)
  })

  /**
   * L3 rotation has now been retired entirely. Both superseded versions of it —
   * the picker-arrow sequence and the safe open-the-picker fallback — must drop
   * out of an untouched stock profile rather than being preserved as though the
   * user had chosen them.
   */
  it('drops retired L3 rotations from an untouched stock profile', () => {
    const staleVariants = [
      { type: 'sequence', clockwise: 'Next model', counter: 'Previous model' },
      {
        type: 'keyboardShortcut',
        clockwise: 'Open model picker',
        counter: 'Open model picker'
      }
    ]

    for (const variant of staleVariants) {
      const stale = [
        ...createDefaultProfile().bindings,
        ...(['rotateClockwise', 'rotateCounterClockwise'] as const).map((gesture, index) => ({
          id: `stale-l3-${index}`,
          input: 'leftStickClick',
          gesture,
          layer: 'base',
          action: {
            type: variant.type,
            title: gesture === 'rotateClockwise' ? variant.clockwise : variant.counter,
            ...(variant.type === 'keyboardShortcut'
              ? {
                  shortcut: {
                    keyCode: 0x2e,
                    keyDisplay: 'M',
                    modifiers: ['control', 'shift']
                  }
                }
              : {})
          },
          focusPolicy: 'focusIfNeeded',
          safety: 'normal',
          isEnabled: true
        }))
      ]

      const bindings = migratedBindings(libraryOf(stale)) as unknown as Array<{
        input: string
        gesture: string
      }>
      expect(
        bindings.filter(
          (binding) =>
            binding.input === 'leftStickClick' && binding.gesture.startsWith('rotate')
        )
      ).toEqual([])
    }
  })

  it('keeps an L3 rotation the user assigned themselves', () => {
    const mine = [
      ...createDefaultProfile().bindings,
      {
        id: 'my-l3',
        input: 'leftStickClick',
        gesture: 'rotateClockwise',
        layer: 'base',
        action: { type: 'openWebURL', title: 'My dashboard' },
        focusPolicy: 'focusIfNeeded',
        safety: 'normal',
        isEnabled: true
      }
    ]
    const bindings = migratedBindings(libraryOf(mine)) as unknown as Array<{
      input: string
      gesture: string
      action: { title: string }
    }>
    expect(
      bindings.find(
        (binding) =>
          binding.input === 'leftStickClick' && binding.gesture === 'rotateClockwise'
      )?.action.title
    ).toBe('My dashboard')
  })

  it('refreshes a shipped mapping whose key changed, keeping its id', () => {
    const current = createDefaultProfile().bindings
    const stale = current.map((binding) =>
      binding.input === 'rightTrigger'
        ? {
            ...binding,
            action: {
              ...binding.action,
              shortcut: { keyCode: 0x24, keyDisplay: '↩', modifiers: ['command'] }
            }
          }
        : binding
    )

    const bindings = migratedBindings(libraryOf(stale)) as unknown as Array<{
      id: string
      input: string
      action: { shortcut?: { modifiers: string[] } }
    }>
    const sent = bindings.find((binding) => binding.input === 'rightTrigger')!

    expect(sent.action.shortcut?.modifiers).toEqual([])
    // The id survives, so the editor selection and autosave do not churn.
    expect(sent.id).toBe(stale.find((binding) => binding.input === 'rightTrigger')!.id)
  })

  it('preserves a shortcut re-recorded on the current default-shaped profile', () => {
    const edited = createDefaultProfile().bindings.map((binding) =>
      binding.input === 'rightTrigger'
        ? {
            ...binding,
            action: {
              ...binding.action,
              shortcut: {
                keyCode: 0x10,
                keyDisplay: 'Y',
                modifiers: ['control' as const, 'option' as const]
              }
            }
          }
        : binding
    )

    const bindings = migratedBindings(libraryOf(edited)) as unknown as Array<{
      input: string
      action: { shortcut?: { keyCode: number; modifiers: string[] } }
    }>
    expect(bindings.find((binding) => binding.input === 'rightTrigger')?.action.shortcut).toEqual({
      keyCode: 0x10,
      keyDisplay: 'Y',
      modifiers: ['control', 'option']
    })
  })

  it('preserves a re-recorded shortcut on an older default signature', () => {
    const edited = supersededDefaultBindings.map((binding) =>
      binding.input === 'buttonA'
        ? {
            ...binding,
            action: {
              ...binding.action,
              shortcut: {
                keyCode: 0x10,
                keyDisplay: 'Y',
                modifiers: ['control', 'option']
              }
            }
          }
        : binding
    )

    const bindings = migratedBindings(libraryOf(edited)) as unknown as Array<{
      input: string
      action: { shortcut?: { keyCode: number; modifiers: string[] } }
    }>
    expect(bindings).toHaveLength(edited.length)
    expect(bindings.find((binding) => binding.input === 'buttonA')?.action.shortcut).toEqual({
      keyCode: 0x10,
      keyDisplay: 'Y',
      modifiers: ['control', 'option']
    })
  })

  it('needs more than a couple of leftovers before it claims a profile', () => {
    const sparse = supersededDefaultBindings.slice(0, 3)
    expect(migratedBindings(libraryOf(sparse))).toHaveLength(3)
  })
})

describe('profile migration', () => {
  /**
   * Dictation is Codex's now, so Codex Controller's own dictation action types are
   * gone. Migration runs before validation, so a saved profile still naming one
   * would fail the schema and take the user's whole library with it. Each is
   * converted to an explicit unassigned binding, which keeps the control visible
   * in the editor rather than making it vanish.
   */
  it('retires a legacy dictation binding to unassigned instead of an invalid type', () => {
    const retired = [
      legacyBinding,
      { ...legacyBinding, id: 'v', action: { type: 'voiceDictation', title: 'Toggle voice dictation' } },
      { ...legacyBinding, id: 's', action: { type: 'sendDictation', title: 'Send dictated message' } }
    ]
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      profiles: [{ schemaVersion: 4, bindings: retired }]
    }) as {
      profiles: Array<{
        bindings: Array<{ action: { type: string }; focusPolicy: string }>
        touchpadPointerEnabled: boolean
        touchpadPointerSpeed: number
      }>
    }

    expect(migrated.profiles[0].bindings).toHaveLength(3)
    for (const binding of migrated.profiles[0].bindings) {
      expect(binding.action.type).toBe('none')
    }
    expect(migrated.profiles[0].touchpadPointerEnabled).toBe(true)
    expect(migrated.profiles[0].touchpadPointerSpeed).toBe(1.25)
  })

  it('leaves no retired action type anywhere the schema would reject', () => {
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      profiles: [
        {
          schemaVersion: 4,
          bindings: [
            { ...legacyBinding, id: 'a', action: { type: 'voiceDictation', title: 'x' } },
            { ...legacyBinding, id: 'b', action: { type: 'keyboardShortcut', title: 'Tab' } }
          ]
        }
      ]
    }) as { profiles: Array<{ bindings: Array<{ action: { type: string } }> }> }

    const types = migrated.profiles[0].bindings.map((binding) => binding.action.type)
    expect(types).not.toContain('voiceDictation')
    expect(types).not.toContain('sendDictation')
  })

  it('does not take ownership of a touchpad that already has a mapping', () => {
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      profiles: [
        {
          schemaVersion: 4,
          bindings: [{ ...legacyBinding, input: 'touchpad' }]
        }
      ]
    }) as { profiles: Array<{ touchpadPointerEnabled: boolean }> }

    expect(migrated.profiles[0].touchpadPointerEnabled).toBe(false)
  })

  it('keeps an existing double-tap action instead of replacing it with voice send', () => {
    const existingDoubleTap = {
      ...legacyBinding,
      id: 'existing-double',
      gesture: 'doubleTap',
      action: { type: 'none', title: 'Keep me' }
    }
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      profiles: [
        {
          schemaVersion: 4,
          bindings: [legacyBinding, existingDoubleTap]
        }
      ]
    }) as { profiles: Array<{ bindings: Array<{ id: string }> }> }

    expect(migrated.profiles[0].bindings).toHaveLength(2)
    expect(migrated.profiles[0].bindings[1].id).toBe('existing-double')
  })

  it('preserves explicit pointer preferences and unrelated mappings', () => {
    const mapping = {
      ...legacyBinding,
      id: 'custom',
      action: { type: 'none', title: 'Unassigned' }
    }
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      profiles: [
        {
          schemaVersion: 4,
          bindings: [mapping],
          touchpadPointerEnabled: false,
          touchpadPointerSpeed: 2
        }
      ]
    }) as {
      profiles: Array<{
        bindings: unknown[]
        touchpadPointerEnabled: boolean
        touchpadPointerSpeed: number
      }>
    }

    expect(migrated.profiles[0]).toMatchObject({
      bindings: [mapping],
      touchpadPointerEnabled: false,
      touchpadPointerSpeed: 2
    })
  })

  /**
   * The Micro companion profile must never be mistaken for an untouched stock
   * layout. If every one of its signatures were also a shipped signature,
   * migration would quietly replace the whole profile with the defaults and the
   * user's opt-in choice would vanish on the next launch.
   */
  it('leaves the Micro companion profile exactly as saved', () => {
    for (const profile of [
      createMicroCompanionProfile(),
      withMicroDialMode(createMicroCompanionProfile(), 'composer-navigation'),
      withMicroDialMode(createMicroCompanionProfile(), 'conversation-scroll')
    ]) {
      const migrated = migrateProfileLibrary({
        schemaVersion: 1,
        activeProfileId: profile.id,
        profiles: [structuredClone(profile)]
      }) as { profiles: Array<Record<string, unknown>> }

      expect(migrated.profiles[0]?.bindings).toEqual(profile.bindings)
      expect(migrated.profiles[0]?.name).toBe(profile.name)
    }
  })

  /**
   * The schema stamp is the one field the repository validates as a literal, so
   * a stale value fails the whole library. The ladder's job is to make sure the
   * stamp is always the current one before validation ever sees it.
   */
  describe('the schema-version ladder', () => {
    const stampsOf = (
      library: unknown
    ): { library: unknown; profile: unknown } => {
      const migrated = migrateProfileLibrary(library) as {
        schemaVersion: unknown
        profiles: Array<{ schemaVersion: unknown }>
      }
      return { library: migrated.schemaVersion, profile: migrated.profiles[0]?.schemaVersion }
    }

    it('carries a stale stamp forward instead of failing on it', () => {
      expect(
        stampsOf({ schemaVersion: 0, profiles: [{ schemaVersion: 1, bindings: [] }] })
      ).toEqual({
        library: currentLibrarySchemaVersion,
        profile: currentProfileSchemaVersion
      })
    })

    it('treats a missing or nonsense stamp as the oldest version', () => {
      expect(stampsOf({ profiles: [{ bindings: [] }] })).toEqual({
        library: currentLibrarySchemaVersion,
        profile: currentProfileSchemaVersion
      })
      expect(
        stampsOf({ schemaVersion: 'one', profiles: [{ schemaVersion: null, bindings: [] }] })
      ).toEqual({
        library: currentLibrarySchemaVersion,
        profile: currentProfileSchemaVersion
      })
    })

    it('keeps the user’s bindings while it restamps', () => {
      const mine = {
        id: 'mine',
        input: 'buttonA',
        gesture: 'tap',
        layer: 'base',
        action: { type: 'openWebURL', title: 'My dashboard' },
        focusPolicy: 'focusIfNeeded',
        safety: 'normal',
        isEnabled: true
      }
      const migrated = migrateProfileLibrary({
        schemaVersion: 1,
        activeProfileId: 'saved',
        profiles: [{ schemaVersion: 2, id: 'saved', name: 'Codex', bindings: [mine] }]
      }) as { profiles: Array<{ bindings: unknown[]; schemaVersion: number }> }

      expect(migrated.profiles[0]?.bindings).toEqual([mine])
      expect(migrated.profiles[0]?.schemaVersion).toBe(currentProfileSchemaVersion)
    })

    /**
     * Restamping a newer library downwards would present it as one this build
     * wrote, and the next save would silently drop whatever the newer version
     * added. Leaving the stamp alone lets validation refuse it, which preserves
     * the file instead of overwriting it.
     */
    it('leaves a stamp newer than this build alone', () => {
      expect(
        stampsOf({
          schemaVersion: currentLibrarySchemaVersion + 1,
          profiles: [{ schemaVersion: currentProfileSchemaVersion + 1, bindings: [] }]
        })
      ).toEqual({
        library: currentLibrarySchemaVersion + 1,
        profile: currentProfileSchemaVersion + 1
      })
    })

    it('leaves unknown extra fields in place for the schema to strip', () => {
      const migrated = migrateProfileLibrary({
        schemaVersion: 1,
        profiles: [{ schemaVersion: 4, bindings: [], futureSetting: 'kept until validation' }]
      }) as { profiles: Array<Record<string, unknown>> }

      expect(migrated.profiles[0]?.futureSetting).toBe('kept until validation')
    })
  })

  it('still migrates a stock profile that sits beside the Micro companion', () => {
    const micro = createMicroCompanionProfile()
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      activeProfileId: micro.id,
      profiles: [structuredClone(micro), { schemaVersion: 4, bindings: [] }]
    }) as { profiles: Array<Record<string, unknown>> }

    expect(migrated.profiles).toHaveLength(2)
    expect(migrated.profiles[0]?.bindings).toEqual(micro.bindings)
  })
})

/**
 * `share` was pickable in the editor but no producer ever emitted it, so every
 * binding on it was dead. It is the Create button under another name.
 */
describe('share bindings', () => {
  const migratedBindings = (
    bindings: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> => {
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      activeProfileId: 'profile-1',
      profiles: [{ schemaVersion: 4, id: 'profile-1', name: 'Mine', bindings }]
    }) as { profiles: Array<{ bindings: Array<Record<string, unknown>> }> }
    return migrated.profiles[0].bindings
  }

  const shareBinding = (update: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'share-1',
    input: 'share',
    gesture: 'tap',
    layer: 'base',
    action: { type: 'keyboardShortcut', title: 'My mapping' },
    focusPolicy: 'focusIfNeeded',
    safety: 'normal',
    isEnabled: true,
    ...update
  })

  const createBinding = (update: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'view-1',
    input: 'view',
    gesture: 'tap',
    layer: 'base',
    action: { type: 'keyboardShortcut', title: 'Create mapping' },
    focusPolicy: 'focusIfNeeded',
    safety: 'normal',
    isEnabled: true,
    ...update
  })

  it('moves a share binding onto the control that actually reports it', () => {
    const [moved] = migratedBindings([shareBinding()])
    expect(moved.input).toBe('view')
    expect(moved.isEnabled).toBe(true)
    expect(moved.action).toEqual({ type: 'keyboardShortcut', title: 'My mapping' })
    expect(moved.id).toBe('share-1')
  })

  /**
   * Two enabled bindings on one gesture is a conflict, and a conflict anywhere
   * blocks autosave — so a collision arrives disabled rather than wedging saves
   * on a profile the user never broke.
   */
  it('disables a moved binding that would collide with an existing Create mapping', () => {
    const bindings = migratedBindings([createBinding(), shareBinding()])
    expect(bindings.map((entry) => entry.input)).toEqual(['view', 'view'])
    expect(bindings[0].isEnabled).toBe(true)
    expect(bindings[1].isEnabled).toBe(false)
  })

  it('keeps a moved binding on a free gesture live', () => {
    const bindings = migratedBindings([createBinding(), shareBinding({ gesture: 'longPress' })])
    expect(bindings[1].isEnabled).toBe(true)
  })

  it('moves share when it is the secondary half of a chord', () => {
    const [moved] = migratedBindings([
      shareBinding({
        input: 'buttonA',
        secondaryInput: 'share',
        gesture: 'chord'
      })
    ])

    expect(moved.input).toBe('buttonA')
    expect(moved.secondaryInput).toBe('view')
    expect(moved.isEnabled).toBe(true)
  })

  it('disables a chord that collapses onto the same input', () => {
    const [moved] = migratedBindings([
      shareBinding({ secondaryInput: 'view', gesture: 'chord' })
    ])

    expect(moved.input).toBe('view')
    expect(moved.secondaryInput).toBe('view')
    expect(moved.isEnabled).toBe(false)
  })

  it('detects a chord collision regardless of primary-input order', () => {
    const bindings = migratedBindings([
      createBinding({
        input: 'view',
        secondaryInput: 'buttonA',
        gesture: 'chord'
      }),
      shareBinding({
        input: 'buttonA',
        secondaryInput: 'share',
        gesture: 'chord'
      })
    ])

    expect(bindings[0].isEnabled).toBe(true)
    expect(bindings[1].isEnabled).toBe(false)
  })

  it('does not let a disabled Create mapping occupy the migrated slot', () => {
    const bindings = migratedBindings([
      createBinding({ isEnabled: false }),
      shareBinding()
    ])

    expect(bindings[0].isEnabled).toBe(false)
    expect(bindings[1].isEnabled).toBe(true)
  })

  it('leaves libraries without a share binding untouched', () => {
    const profile = createDefaultProfile()
    const migrated = migrateProfileLibrary({
      schemaVersion: 1,
      activeProfileId: profile.id,
      profiles: [structuredClone(profile)]
    }) as { profiles: Array<Record<string, unknown>> }
    expect(migrated.profiles[0]?.bindings).toEqual(profile.bindings)
  })
})
