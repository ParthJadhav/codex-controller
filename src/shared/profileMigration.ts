import { createDefaultProfile } from './defaultProfile'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const bindingSignature = (binding: Record<string, unknown>): string => {
  const action = isRecord(binding.action) ? binding.action : {}
  return [binding.input, binding.gesture, action.type, action.title].join('|')
}

/**
 * Removes generated identities, while retaining every behavior-bearing field.
 *
 * The entire ordered binding list is fingerprinted: adding a placeholder,
 * deleting or reordering a binding, disabling one, changing focus/safety, or
 * editing any nested sequence field makes the profile user-owned. Modifier
 * order is normalized because it has no dispatch meaning.
 */
const semanticValue = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => semanticValue(entry))
    return key === 'modifiers' ? [...entries].sort() : entries
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((entry) => entry !== 'id' && value[entry] !== undefined)
      .map((entry) => [entry, semanticValue(value[entry], entry)])
  )
}

const bindingListFingerprint = (bindings: unknown[]): string =>
  JSON.stringify(semanticValue(bindings))

const historicalShortcut = (
  keyCode: number,
  keyDisplay: string,
  modifiers: string[] = []
): Record<string, unknown> => ({ keyCode, keyDisplay, modifiers })

const historicalBinding = (
  input: string,
  gesture: string,
  action: Record<string, unknown>,
  focusPolicy = 'focusIfNeeded'
): Record<string, unknown> => ({
  input,
  gesture,
  layer: 'base',
  action,
  focusPolicy,
  safety: 'normal',
  isEnabled: true
})

/** The exact default committed in the first public revision. */
const originalDefaultRevision: unknown[] = [
  historicalBinding(
    'buttonA',
    'tap',
    {
      type: 'keyboardShortcut',
      title: 'Send / activate',
      shortcut: historicalShortcut(0x24, '↩')
    },
    'frontmostOnly'
  ),
  historicalBinding(
    'buttonB',
    'tap',
    {
      type: 'keyboardShortcut',
      title: 'Escape / cancel',
      shortcut: historicalShortcut(0x35, 'Esc')
    },
    'frontmostOnly'
  ),
  historicalBinding('buttonX', 'tap', {
    type: 'keyboardShortcut',
    title: 'Toggle review',
    shortcut: historicalShortcut(0x05, 'G', ['control', 'shift'])
  }),
  historicalBinding(
    'buttonY',
    'tap',
    { type: 'deepLink', title: 'New task', deepLinkURL: 'codex://threads/new' },
    'neverFocus'
  ),
  historicalBinding('dpadLeft', 'tap', {
    type: 'keyboardShortcut',
    title: 'Navigate back',
    shortcut: historicalShortcut(0x21, '[', ['command'])
  }),
  historicalBinding('dpadRight', 'tap', {
    type: 'keyboardShortcut',
    title: 'Navigate forward',
    shortcut: historicalShortcut(0x1e, ']', ['command'])
  }),
  historicalBinding('dpadDown', 'tap', {
    type: 'keyboardShortcut',
    title: 'Toggle sidebar',
    shortcut: historicalShortcut(0x0b, 'B', ['command'])
  }),
  historicalBinding('dpadUp', 'tap', {
    type: 'keyboardShortcut',
    title: 'Command menu',
    shortcut: historicalShortcut(0x23, 'P', ['command', 'shift'])
  }),
  historicalBinding('view', 'tap', {
    type: 'keyboardShortcut',
    title: 'Search tasks',
    shortcut: historicalShortcut(0x05, 'G', ['command'])
  }),
  historicalBinding(
    'menu',
    'tap',
    { type: 'deepLink', title: 'Open Settings', deepLinkURL: 'codex://settings' },
    'neverFocus'
  ),
  historicalBinding(
    'leftShoulder',
    'holdBegan',
    { type: 'layerShift', title: 'Hold Review layer', targetLayer: 'review' },
    'neverFocus'
  ),
  historicalBinding('rightShoulder', 'tap', {
    type: 'keyboardShortcut',
    title: 'Command menu',
    shortcut: historicalShortcut(0x28, 'K', ['command'])
  }),
  historicalBinding(
    'leftTrigger',
    'tap',
    { type: 'voiceDictation', title: 'Toggle voice dictation' },
    'neverFocus'
  ),
  historicalBinding('leftTrigger', 'doubleTap', {
    type: 'sendDictation',
    title: 'Send dictated message'
  }),
  historicalBinding('leftStickClick', 'tap', {
    type: 'keyboardShortcut',
    title: 'Toggle terminal',
    shortcut: historicalShortcut(0x32, '`', ['control'])
  }),
  historicalBinding('rightStickClick', 'tap', {
    type: 'keyboardShortcut',
    title: 'Toggle bottom panel',
    shortcut: historicalShortcut(0x26, 'J', ['command'])
  })
]

/** A complete, short-lived revision that drove Codex Controller's own task actions. */
const controlDeckDefaultRevision: unknown[] = [
  historicalBinding('dpadUp', 'tap', {
    type: 'keyboardShortcut',
    title: 'Arrow up',
    shortcut: historicalShortcut(0x7e, '↑')
  }),
  historicalBinding('dpadDown', 'tap', {
    type: 'keyboardShortcut',
    title: 'Arrow down',
    shortcut: historicalShortcut(0x7d, '↓')
  }),
  historicalBinding('dpadLeft', 'tap', {
    type: 'keyboardShortcut',
    title: 'Arrow left',
    shortcut: historicalShortcut(0x7b, '←')
  }),
  historicalBinding('dpadRight', 'tap', {
    type: 'keyboardShortcut',
    title: 'Arrow right',
    shortcut: historicalShortcut(0x7c, '→')
  }),
  historicalBinding('buttonA', 'tap', {
    type: 'keyboardShortcut',
    title: 'Return',
    shortcut: historicalShortcut(0x24, '↩')
  }),
  historicalBinding('buttonB', 'tap', {
    type: 'keyboardShortcut',
    title: 'Escape',
    shortcut: historicalShortcut(0x35, 'Esc')
  }),
  historicalBinding('buttonX', 'tap', {
    type: 'openProjectPicker',
    title: 'Open the project picker'
  }),
  historicalBinding('buttonY', 'tap', { type: 'newTask', title: 'New task' }),
  historicalBinding('rightTrigger', 'tap', {
    type: 'sendTask',
    title: 'Send or run the task'
  }),
  historicalBinding('view', 'tap', {
    type: 'startDictation',
    title: 'Start voice capture'
  }),
  historicalBinding('view', 'longPress', {
    type: 'stopDictation',
    title: 'Stop voice capture'
  }),
  historicalBinding('leftStickClick', 'rotateClockwise', {
    type: 'cycleModel',
    title: 'Next model'
  })
]

const knownDefaultRevisionFingerprints = (): Set<string> => {
  const current = createDefaultProfile().bindings as unknown as unknown[]
  const staleSend = current.map((binding) => {
    if (!isRecord(binding) || binding.input !== 'rightTrigger' || !isRecord(binding.action)) {
      return binding
    }
    return {
      ...binding,
      action: {
        ...binding.action,
        shortcut: historicalShortcut(0x24, '↩', ['command'])
      }
    }
  })
  const staleRotations = (type: 'sequence' | 'keyboardShortcut'): unknown[] => [
    ...current,
    ...(['rotateClockwise', 'rotateCounterClockwise'] as const).map((gesture) =>
      historicalBinding('leftStickClick', gesture, {
        type,
        title:
          type === 'keyboardShortcut'
            ? 'Open model picker'
            : gesture === 'rotateClockwise'
              ? 'Next model'
              : 'Previous model',
        ...(type === 'keyboardShortcut'
          ? { shortcut: historicalShortcut(0x2e, 'M', ['control', 'shift']) }
          : {})
      })
    )
  ]
  return new Set(
    [
      current,
      originalDefaultRevision,
      controlDeckDefaultRevision,
      staleSend,
      staleRotations('sequence'),
      staleRotations('keyboardShortcut')
    ].map(bindingListFingerprint)
  )
}

const isUntouchedSupersededDefault = (bindings: unknown[]): boolean =>
  knownDefaultRevisionFingerprints().has(bindingListFingerprint(bindings))

/**
 * Action types Codex Controller used to have, from when it ran dictation itself.
 *
 * Dictation now belongs entirely to Codex — Create holds Codex's own dictation
 * shortcut — so these types no longer exist. Migration runs before validation,
 * and a saved profile still naming one of them would fail the schema and take
 * the user's whole library down with it. They are converted to an explicit
 * unassigned binding rather than dropped, so the control stays visible in the
 * editor and can be remapped instead of quietly disappearing.
 */
const retiredDictationActionTypes = new Set(['voiceDictation', 'sendDictation'])

const isRetiredDictationAction = (action: unknown): boolean => {
  if (!isRecord(action)) return false
  if (typeof action.type === 'string' && retiredDictationActionTypes.has(action.type)) return true
  // The older form: a plain ⌃⇧D shortcut titled "Toggle dictation".
  if (action.type !== 'keyboardShortcut') return false
  if (action.title !== 'Toggle dictation' || !isRecord(action.shortcut)) return false
  const modifiers = action.shortcut.modifiers
  return (
    action.shortcut.keyCode === 2 &&
    Array.isArray(modifiers) &&
    modifiers.length === 2 &&
    modifiers.includes('control') &&
    modifiers.includes('shift')
  )
}

/**
 * `share` was pickable in the editor but nothing ever emitted it — the bridge and
 * the Web Gamepad fallback both report that physical button as `view`, which is
 * what a DualSense calls Create. A binding on it could never fire.
 *
 * Moving it onto `view` is what makes the mapping the user authored start
 * working. When the same layer already has a `view` binding for that gesture the
 * moved one arrives disabled rather than enabled: two enabled bindings on one
 * gesture are a conflict, and a conflict anywhere in the library blocks autosave,
 * so adopting the collision would wedge saving on a profile the user never
 * broke. Disabled keeps the mapping visible and one switch away from live.
 */
const migrateShareBindings = (bindings: unknown[]): unknown[] => {
  const affected = (binding: unknown): boolean =>
    isRecord(binding) &&
    (binding.input === 'share' || binding.secondaryInput === 'share')
  if (!bindings.some(affected)) return bindings

  const normalize = (binding: Record<string, unknown>): Record<string, unknown> => ({
    ...binding,
    input: binding.input === 'share' ? 'view' : binding.input,
    ...(binding.secondaryInput === 'share' ? { secondaryInput: 'view' } : {})
  })
  const slotFor = (binding: Record<string, unknown>): string => {
    const layer = binding.layer ?? 'base'
    if (binding.gesture === 'chord' && typeof binding.secondaryInput === 'string') {
      const inputs = [String(binding.input), binding.secondaryInput].sort()
      return `${layer}|${inputs[0]}+${inputs[1]}|chord`
    }
    return `${layer}|${binding.input}|${binding.gesture}`
  }
  const occupied = new Set<string>()
  for (const binding of bindings) {
    if (!isRecord(binding) || affected(binding) || binding.isEnabled !== true) continue
    occupied.add(slotFor(binding))
  }

  return bindings.map((binding) => {
    if (!isRecord(binding) || !affected(binding)) return binding
    const normalized = normalize(binding)
    const isSelfChord =
      normalized.gesture === 'chord' &&
      normalized.secondaryInput !== undefined &&
      normalized.input === normalized.secondaryInput
    const slot = slotFor(normalized)
    const collides = normalized.isEnabled === true && occupied.has(slot)
    const isEnabled = isSelfChord || collides ? false : normalized.isEnabled
    if (isEnabled === true) occupied.add(slot)
    return { ...normalized, isEnabled }
  })
}

/**
 * Keeps the saved binding ids so an adoption that only refreshes a shortcut does
 * not churn every id in the file, and returns the saved bindings untouched when
 * they already match — otherwise every launch would rewrite the profile with
 * freshly generated ids.
 */
const adoptCurrentDefaults = (bindings: unknown[]): unknown[] => {
  const current = createDefaultProfile().bindings
  const assigned = bindings.filter(
    (binding): binding is Record<string, unknown> => isRecord(binding)
  )
  if (
    bindingListFingerprint(bindings) ===
    bindingListFingerprint(current as unknown as unknown[])
  ) {
    return bindings
  }

  const savedById = new Map(
    assigned.map((binding) => [bindingSignature(binding), binding.id])
  )
  return current.map((binding) => {
    const existingId = savedById.get(
      bindingSignature(binding as unknown as Record<string, unknown>)
    )
    return typeof existingId === 'string' ? { ...binding, id: existingId } : binding
  })
}

/** The profile shape the app writes today. */
export const currentProfileSchemaVersion = 4
/** The library envelope the app writes today. */
export const currentLibrarySchemaVersion = 1

/**
 * The stamp a saved record claims, or `null` when it is missing or nonsense —
 * which is treated as "older than anything we track" rather than as a reason to
 * reject the file. A profile written before the stamp existed still holds the
 * user's bindings.
 */
const savedSchemaVersion = (value: Record<string, unknown>): number | null => {
  const raw = value.schemaVersion
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null
}

type SchemaRung = (value: Record<string, unknown>) => Record<string, unknown>

/**
 * One rung per schema version the app has ever written, carrying a record saved
 * at that version up to the next one.
 *
 * The rungs are identity today, and that is not an oversight: every shape
 * difference Codex Controller has actually shipped — retired action types, the
 * touchpad-pointer fields, superseded default layouts — is detected from the
 * content itself by the normalisation below, which is idempotent and safe to run
 * against any version. The ladder exists so the *stamp* is always brought
 * forward, which is what stops a stale `schemaVersion` from failing validation
 * and taking the whole library with it, and so the next schema change has an
 * obvious place to put real work.
 */
const profileSchemaRungs: ReadonlyMap<number, SchemaRung> = new Map([
  [1, (profile) => profile],
  [2, (profile) => profile],
  [3, (profile) => profile]
])

const librarySchemaRungs: ReadonlyMap<number, SchemaRung> = new Map()

/**
 * Walks a record up the ladder and stamps it with the current version.
 *
 * A record stamped *newer* than this build is returned untouched. Restamping it
 * downwards would present a library this app cannot fully understand as one it
 * wrote, and any field the newer version added would be silently dropped on the
 * next save; leaving the stamp alone means validation rejects it, which now
 * preserves the file and reports the problem instead of overwriting it.
 */
const climbSchema = (
  value: Record<string, unknown>,
  rungs: ReadonlyMap<number, SchemaRung>,
  currentVersion: number
): Record<string, unknown> => {
  const saved = savedSchemaVersion(value)
  if (saved !== null && saved > currentVersion) return value

  let climbed = value
  for (let version = saved ?? 1; version < currentVersion; version += 1) {
    const rung = rungs.get(version)
    if (rung) climbed = rung(climbed)
  }
  return { ...climbed, schemaVersion: currentVersion }
}

const migrateProfile = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  const sourceBindings = Array.isArray(value.bindings) ? value.bindings : []
  const shouldAdoptCurrentDefaults = isUntouchedSupersededDefault(sourceBindings)
  const hasTouchpadBinding = sourceBindings.some(
    (binding) => isRecord(binding) && binding.input === 'touchpad'
  )
  const bindings = migrateShareBindings(
    sourceBindings.map((binding) => {
      if (!isRecord(binding) || !isRetiredDictationAction(binding.action)) return binding
      return {
        ...binding,
        action: { type: 'none', title: 'Unassigned' },
        focusPolicy: 'focusIfNeeded'
      }
    })
  )
  const normalized = {
    ...value,
    bindings: shouldAdoptCurrentDefaults ? adoptCurrentDefaults(bindings) : bindings,
    touchpadPointerEnabled:
      typeof value.touchpadPointerEnabled === 'boolean'
        ? value.touchpadPointerEnabled
        : !hasTouchpadBinding,
    touchpadPointerSpeed:
      typeof value.touchpadPointerSpeed === 'number' ? value.touchpadPointerSpeed : 1.25
  }
  return climbSchema(normalized, profileSchemaRungs, currentProfileSchemaVersion)
}

/**
 * Standalone profile exports use the same migration ladder as profiles nested
 * in a library. Keeping this wrapper public avoids making importers invent a
 * temporary library envelope just to bring one profile up to date.
 */
export const migrateMappingProfile = (value: unknown): unknown => migrateProfile(value)

export const migrateProfileLibrary = (value: unknown): unknown => {
  if (!isRecord(value) || !Array.isArray(value.profiles)) return value
  return climbSchema(
    { ...value, profiles: value.profiles.map(migrateProfile) },
    librarySchemaRungs,
    currentLibrarySchemaVersion
  )
}
