import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  inputDisplayNames,
  pickableControllerInputIds,
  type AgentActivity,
  type ControllerBinding,
  type ControllerInputId,
  type ControllerLightStatus,
  type CodexKeymapStatusSnapshot,
  type CodexKeymapWriteSnapshot,
  type ControllerSnapshot,
  type FeedbackTone,
  type MappingLayer,
  type MappingProfile,
  type NativeBridgeEvent,
  type ProfileLibrary,
  type SystemSnapshot
} from '@shared/contracts'
import { profileLimits } from '@shared/profileLimits'
import { unacknowledgedCodexCommand } from '@shared/codexCommands'
import {
  managedCodexBindingsFor,
  type UnwritableBinding
} from '@shared/codexKeybindings'
import { createDefaultProfile } from '@shared/defaultProfile'
import { formatShortcut } from '../core/shortcutDisplay'
import {
  MICRO_PROFILE_NAME,
  createMicroCompanionProfile,
  microDialModeFromProfile,
  withMicroDialMode,
  type MicroDialMode
} from '@shared/microProfile'
import { GamepadService, defaultAxisThresholds, type AxisThresholds } from '../core/gamepadService'
import { GestureEngine } from '../core/gestureEngine'
import { controllerInputSuspension } from '../core/inputSuspension'
import { dominantLightStatus, lightColors } from '../core/lightStatus'
import { mappingConflicts, resolveBinding } from '../core/mappingResolver'
import { profileAutosaveIssue } from '../core/profileAutosave'
import { duplicateProfileName } from '../core/profileNames'
import { StickRotationTracker } from '../core/stickRotation'
import { stickVectorFromActiveValues } from '../core/stickMotion'
import {
  appendRotationTrace,
  rotationStickSides,
  stickTelemetry,
  type RotationStickId,
  type RotationTraceEntry,
  type StickTelemetry
} from '../core/rotationDiagnostics'

export type AppSection = 'controller' | 'mappings' | 'diagnostics' | 'settings'
export type AutosaveState = 'saved' | 'pending' | 'saving' | 'invalid' | 'error'

const disconnectedController: ControllerSnapshot = {
  connected: false,
  id: '',
  name: 'DualSense Wireless Controller',
  productCategory: 'DualSense',
  transport: 'Unknown',
  batteryLevel: null,
  supportsLight: false,
  supportsHaptics: false,
  touchpadPointerEnabled: false,
  touchpadPointerStatus: 'disconnected',
  capabilities: [],
  activeValues: {}
}

const withoutActiveInputs = (snapshot: ControllerSnapshot): ControllerSnapshot => ({
  ...snapshot,
  activeValues: {},
  lastInput: undefined,
  lastPressed: undefined
})

const experimentalMicrophonePreferenceKey =
  'codex-controller.experimental-dualsense-microphone'
const legacyExperimentalMicrophonePreferenceKey =
  'controller-controls.experimental-dualsense-microphone'

const compatibleLocalStorageValue = (currentKey: string, legacyKey: string): string | null => {
  const current = window.localStorage.getItem(currentKey)
  if (current !== null) return current
  const legacy = window.localStorage.getItem(legacyKey)
  if (legacy !== null) window.localStorage.setItem(currentKey, legacy)
  return legacy
}

/**
 * Codex command IDs the user has told us they bound inside Codex.
 *
 * Posting a shortcut proves only that the key was delivered. For a command
 * Codex registers with no default binding, a delivered key does nothing at all,
 * and reporting that as success is how "it says it increased the effort but the
 * effort never changes" happens. We cannot read Codex's keymap, so the user is
 * the only source of truth for whether the binding exists — and until they say
 * so, the honest report is "sent, but Codex may have nothing bound".
 */
const codexBindingsConfirmedKey = 'codex-controller.codex-bindings-confirmed'
const legacyCodexBindingsConfirmedKey = 'controller-controls.codex-bindings-confirmed'

const readConfirmedBindings = (): string[] => {
  try {
    const raw = compatibleLocalStorageValue(
      codexBindingsConfirmedKey,
      legacyCodexBindingsConfirmedKey
    )
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}
const createInitialLibrary = (): ProfileLibrary => {
  const profile = createDefaultProfile()
  return { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
}

const createUnassignedBinding = (input: ControllerInputId): ControllerBinding => ({
  id: crypto.randomUUID(),
  input,
  gesture: 'tap',
  layer: 'base',
  action: { type: 'none', title: 'Unassigned' },
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  isEnabled: true
})

const hasSameControllerMetadata = (
  current: ControllerSnapshot,
  next: ControllerSnapshot
): boolean =>
  current.connected === next.connected &&
  current.id === next.id &&
  current.name === next.name &&
  current.productCategory === next.productCategory &&
  current.transport === next.transport &&
  current.batteryLevel === next.batteryLevel &&
  current.supportsLight === next.supportsLight &&
  current.supportsHaptics === next.supportsHaptics &&
  current.inputSuspended === next.inputSuspended &&
  current.touchpadPointerEnabled === next.touchpadPointerEnabled &&
  current.touchpadPointerStatus === next.touchpadPointerStatus &&
  JSON.stringify(current.touchpadPointerDiagnostics) ===
    JSON.stringify(next.touchpadPointerDiagnostics) &&
  current.capabilities.length === next.capabilities.length &&
  current.capabilities.every((capability, index) => capability === next.capabilities[index])
export interface ControllerEventEntry {
  id: string
  input: ControllerInputId
  value: number
  pressed: boolean
  timestamp: number
  source: 'native' | 'gamepad'
}

/**
 * Live rotation evidence, per stick. `everTracked` is sticky for the session
 * because the interesting case is a stick that reached the threshold at some
 * point during the circle, not one that happens to be there at read time.
 */
export interface StickDiagnostics {
  left: StickTelemetry & { everTracked: boolean }
  right: StickTelemetry & { everTracked: boolean }
}

const idleTelemetry = (): StickTelemetry & { everTracked: boolean } => ({
  ...stickTelemetry('left', {}),
  everTracked: false
})

const idleStickDiagnostics = (): StickDiagnostics => ({
  left: idleTelemetry(),
  right: idleTelemetry()
})

/**
 * Keymap status plus the mappings we could not express as an accelerator, which
 * only the renderer knows because only it has the active profile.
 */
export interface CodexKeymapView extends CodexKeymapStatusSnapshot {
  unwritable: UnwritableBinding[]
}

/**
 * A fingerprint of everything about the profile that could change what Codex
 * needs bound. Recomputing status on this rather than on mount is what makes
 * the button stop claiming "already set up" after a mapping is re-recorded,
 * enabled, disabled, or the profile is switched.
 */
const codexBindingSignature = (profile: MappingProfile | null): string =>
  managedCodexBindingsFor(profile)
    .bindings.map((entry) => `${entry.commandId}=${entry.accelerator}`)
    .join('|')

export function useControllerApp() {
  const [section, setSection] = useState<AppSection>('controller')
  const profileEditsAcceptedRef = useRef(true)
  const [library, setLibraryState] = useState<ProfileLibrary>(createInitialLibrary)
  /**
   * Once quit-time flushing starts, the profile snapshot is immutable.
   *
   * `before-quit` is prevented while the renderer saves, so without this gate
   * the user could edit snapshot B after snapshot A's flush had completed but
   * before the main process reached its final `app.quit()`. The pagehide save
   * for B would then arrive after the main process's durability barrier.
   */
  const setLibrary = useCallback(
    (next: ProfileLibrary | ((current: ProfileLibrary) => ProfileLibrary)): void => {
      if (!profileEditsAcceptedRef.current) return
      setLibraryState(next)
    },
    []
  )
  const [selectedInput, setSelectedInput] = useState<ControllerInputId | null>(null)
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null)
  /**
   * The Unassigned binding the editor shows for a control that has none yet,
   * held outside the library until the user actually edits it.
   *
   * Clicking a control on the 3D stage used to append that binding to the
   * profile immediately, which dirtied the library and autosaved a mapping
   * nobody authored 600 ms later — so browsing the controller rewrote the file
   * and could park the whole library in "invalid" on a duplicate gesture.
   */
  const [draftBinding, setDraftBinding] = useState<ControllerBinding | null>(null)
  const [activeLayer, setActiveLayer] = useState<MappingLayer>('base')
  const [controller, setController] = useState<ControllerSnapshot>(disconnectedController)
  const [isEnabled, setIsEnabled] = useState(true)
  const [isActionRunning, setIsActionRunning] = useState(false)
  const [transientLight, setTransientLight] = useState<'success' | 'failure' | undefined>()
  const [system, setSystem] = useState<SystemSnapshot | null>(null)
  const [experimentalDualSenseMicrophoneEnabled, setExperimentalMicrophoneState] =
    useState(
      () =>
        compatibleLocalStorageValue(
          experimentalMicrophonePreferenceKey,
          legacyExperimentalMicrophonePreferenceKey
        ) === 'true'
    )
  const [isSpeakerTestRunning, setIsSpeakerTestRunning] = useState(false)
  const [codexBindingsConfirmed, setCodexBindingsConfirmedState] =
    useState<string[]>(readConfirmedBindings)
  const [codexKeymap, setCodexKeymap] = useState<CodexKeymapView | null>(null)
  const [isApplyingCodexKeymap, setIsApplyingCodexKeymap] = useState(false)
  const [codexRestartPrompt, setCodexRestartPrompt] =
    useState<CodexKeymapWriteSnapshot | null>(null)
  const [stickRotation] = useState(() => ({
    left: new StickRotationTracker(),
    right: new StickRotationTracker()
  }))
  /**
   * True while controller presses must not be turned into actions.
   *
   * Two independent sources close this gate and either one is enough, so they
   * are tracked separately and combined: the shortcut recorder listening for a
   * keystroke, and the bridge reporting `inputSuspended` while it verifies the
   * microphone.
   */
  const mappingsSuspendedRef = useRef(false)
  const recordingSuspendedRef = useRef(false)
  const bridgeSuspendedRef = useRef(false)
  const [mappingsSuspended, setMappingsSuspended] = useState(false)
  const [controllerEvents, setControllerEvents] = useState<ControllerEventEntry[]>([])
  const [rotationTrace, setRotationTrace] = useState<RotationTraceEntry[]>([])
  const [stickDiagnostics, setStickDiagnostics] = useState<StickDiagnostics>(idleStickDiagnostics)
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('saved')
  const [autosaveMessage, setAutosaveMessage] = useState('All changes saved')
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null)
  const sectionRef = useRef(section)
  const libraryRef = useRef(library)
  const savedLibraryRef = useRef<ProfileLibrary | null>(null)
  if (savedLibraryRef.current === null) {
    savedLibraryRef.current = structuredClone(library)
  }
  const libraryLoadedRef = useRef(false)
  const [autosaveQueueRef] = useState(() => ({ current: Promise.resolve() }))
  const autosaveInFlightRef = useRef(false)
  const autosaveRequestCounterRef = useRef(0)
  const lastAutosaveRequestRef = useRef<{
    id: number
    serialized: string
    promise: Promise<ProfileLibrary>
  } | null>(null)
  const lastAutosaveErrorRef = useRef<string | null>(null)
  const activeLayerRef = useRef(activeLayer)
  /**
   * Which held control engaged which layer, newest last.
   *
   * A momentary shift belongs to the control holding it. Resetting to `base` on
   * any `holdEnded` meant that with two shift controls down, letting go of the
   * second dropped the layer the first one was still holding.
   */
  const layerShiftHoldsRef = useRef(new Map<ControllerInputId, MappingLayer>())
  const enabledRef = useRef(isEnabled)
  const nativeControllerSeen = useRef(false)
  const controllerWasConnected = useRef(false)
  const gamepadServiceRef = useRef<GamepadService | null>(null)
  /**
   * The active profile's axis edges, mirrored where the non-React paths can
   * read them: the Web Gamepad fallback service, and the diagnostics entry for
   * a native snapshot that reports a value without saying whether it counts as
   * a press. Both used to answer with a constant of their own.
   */
  const axisThresholdsRef = useRef<AxisThresholds>(defaultAxisThresholds)
  const [gestureEngine] = useState(() => new GestureEngine())
  const pendingControllerRef = useRef<ControllerSnapshot | null>(null)
  const pendingControllerEventsRef = useRef<ControllerEventEntry[]>([])
  const controllerMetadataRef = useRef(disconnectedController)
  const controllerActiveValuesRef = useRef<ControllerSnapshot['activeValues']>({})
  const controllerEventsRef = useRef<ControllerEventEntry[]>([])
  const rotationTraceRef = useRef<RotationTraceEntry[]>([])
  const stickDiagnosticsRef = useRef<StickDiagnostics>(idleStickDiagnostics())
  const controllerRenderFrameRef = useRef<number | null>(null)
  const lastQueuedControllerEventRef = useRef<ControllerEventEntry | null>(null)
  const transientLightTimerRef = useRef<number | null>(null)
  const codexBindingsConfirmedRef = useRef(codexBindingsConfirmed)
  const activeValuesListenersRef = useRef(new Set<() => void>())
  /** Every dispatched promise, so one fast action cannot hide a slower sibling. */
  const pendingActionCountRef = useRef(0)
  /**
   * The binding that actually posted key-down for each physical control.
   *
   * Releases must not be resolved from the mutable profile: the user can delete
   * or disable a release binding while the key is down, and editor-authored
   * holds historically had no release binding at all.
   */
  const activeHoldShortcutsRef = useRef(new Map<ControllerInputId, ControllerBinding>())

  const notifyActiveValues = useCallback((): void => {
    for (const listener of activeValuesListenersRef.current) listener()
  }, [])

  /**
   * Push notification for `controllerActiveValuesRef`. The 3D scene renders on
   * demand and parks its animation frame when nothing is moving, so it cannot
   * discover new controller values by polling the ref — it has to be told.
   */
  const subscribeActiveValues = useCallback((listener: () => void): (() => void) => {
    const listeners = activeValuesListenersRef.current
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useLayoutEffect(() => {
    sectionRef.current = section
    libraryRef.current = library
    activeLayerRef.current = activeLayer
    enabledRef.current = isEnabled
    codexBindingsConfirmedRef.current = codexBindingsConfirmed
  }, [activeLayer, codexBindingsConfirmed, isEnabled, library, section])

  const refreshCodexKeymap = useCallback(async (): Promise<void> => {
    // Reading Codex's keymap is a nicety, not a dependency: the controls still
    // work without it, and a renderer paired with a preload that has no `codex`
    // bridge should degrade to "unknown" rather than fail to start.
    try {
      const managed = managedCodexBindingsFor(libraryRef.current.profiles.find(
        (profile) => profile.id === libraryRef.current.activeProfileId
      ) ?? null)
      const status = await window.controllerControls.codex?.keymapStatus(managed.bindings)
      if (status) setCodexKeymap({ ...status, unwritable: managed.unwritable })
    } catch {
      setCodexKeymap(null)
    }
  }, [])

  /**
   * Writes the shortcuts Codex ships unbound into Codex's own keymap.
   *
   * Only ever from this explicit call. On success the per-command "I bound
   * this" acknowledgements are set for us, because we now know the binding
   * exists — the user should not have to confirm something we just did.
   */
  const applyCodexKeymap = useCallback(async (): Promise<void> => {
    setIsApplyingCodexKeymap(true)
    try {
      const managed = managedCodexBindingsFor(libraryRef.current.profiles.find(
        (profile) => profile.id === libraryRef.current.activeProfileId
      ) ?? null)
      const result = await window.controllerControls.codex?.applyKeymap(managed.bindings)
      if (!result) {
        toast.error('Codex shortcut setup is unavailable in this build')
        return
      }
      if (result.status === 'applied') setCodexRestartPrompt(result)
      if (result.status === 'applied' || result.status === 'unchanged') {
        const bound = result.entries
          .filter((entry) => entry.state !== 'conflict')
          .map((entry) => entry.commandId)
        setCodexBindingsConfirmedState((current) => {
          const next = [...new Set([...current, ...bound])]
          window.localStorage.setItem(codexBindingsConfirmedKey, JSON.stringify(next))
          return next
        })
        toast.success(
          result.status === 'applied' ? 'Updated Codex shortcuts' : 'Codex shortcuts already set',
          { description: result.message }
        )
      } else {
        toast.error('Could not update Codex shortcuts', { description: result.message })
      }
      await refreshCodexKeymap()
    } finally {
      setIsApplyingCodexKeymap(false)
    }
  }, [refreshCodexKeymap])

  const dismissCodexRestartPrompt = useCallback((): void => setCodexRestartPrompt(null), [])

  const setCodexBindingConfirmed = useCallback((commandId: string, confirmed: boolean): void => {
    setCodexBindingsConfirmedState((current) => {
      const next = confirmed
        ? current.includes(commandId)
          ? current
          : [...current, commandId]
        : current.filter((entry) => entry !== commandId)
      window.localStorage.setItem(codexBindingsConfirmedKey, JSON.stringify(next))
      return next
    })
  }, [])

  const activeProfile = useMemo(
    () =>
      library.profiles.find((profile) => profile.id === library.activeProfileId) ??
      library.profiles[0]!,
    [library]
  )

  const selectedBinding = useMemo(
    () =>
      (draftBinding?.id === selectedBindingId ? draftBinding : null) ??
      activeProfile?.bindings.find((binding) => binding.id === selectedBindingId) ??
      activeProfile?.bindings.find(
        (binding) => binding.input === selectedInput && binding.layer === activeLayer
      ) ??
      activeProfile?.bindings.find(
        (binding) => binding.input === selectedInput && binding.layer === 'base'
      ) ??
      null,
    [activeLayer, activeProfile, draftBinding, selectedBindingId, selectedInput]
  )

  // A draft only exists for as long as it is the selection. Anything that moves
  // the selection elsewhere — deselecting, picking a row, switching profile —
  // therefore discards it without having to say so.
  useEffect(() => {
    if (draftBinding && draftBinding.id !== selectedBindingId) setDraftBinding(null)
  }, [draftBinding, selectedBindingId])

  const flushControllerRender = useCallback((): void => {
    controllerRenderFrameRef.current = null
    const nextController = pendingControllerRef.current
    const nextEvents = pendingControllerEventsRef.current
    pendingControllerRef.current = null
    pendingControllerEventsRef.current = []

    if (
      nextController &&
      !hasSameControllerMetadata(controllerMetadataRef.current, nextController)
    ) {
      controllerMetadataRef.current = nextController
      setController(nextController)
    }
    if (nextEvents.length > 0) {
      const merged = [...nextEvents]
        .reverse()
        .concat(controllerEventsRef.current)
        .slice(0, 160)
      controllerEventsRef.current = merged
      if (sectionRef.current === 'diagnostics') setControllerEvents(merged)
    }
    // Rotation evidence is only rendered on the Diagnostics page, so it is only
    // pushed into state there. Elsewhere the refs keep accumulating silently and
    // the page picks them up whole when it opens.
    if (sectionRef.current === 'diagnostics') {
      setStickDiagnostics(stickDiagnosticsRef.current)
      setRotationTrace(rotationTraceRef.current)
    }
  }, [])

  /**
   * The sticks have no encoder, so a rotation is recovered from the position
   * stream and then enters the ordinary gesture pipeline. L3 and R3 name the
   * stick being turned, exactly as they name its click.
   */
  const feedStickRotation = useCallback(
    (values: ControllerSnapshot['activeValues']): void => {
      const timestamp = performance.now() / 1_000
      const track = (input: RotationStickId): void => {
        const side = rotationStickSides[input]
        const tracker = stickRotation[side]
        const vector = stickVectorFromActiveValues(side, values)
        const step = tracker.update(vector.x, vector.y)
        if (step) gestureEngine.emitRotation(input, step, timestamp)

        const telemetry = stickTelemetry(
          side,
          values,
          tracker.accumulatedRadians,
          tracker.rejectedSampleCount
        )
        stickDiagnosticsRef.current = {
          ...stickDiagnosticsRef.current,
          [side]: {
            ...telemetry,
            everTracked: stickDiagnosticsRef.current[side].everTracked || telemetry.tracking
          }
        }
        if (step) {
          rotationTraceRef.current = appendRotationTrace(rotationTraceRef.current, {
            id: crypto.randomUUID(),
            input,
            step,
            timestamp,
            magnitude: telemetry.magnitude,
            angleDegrees: telemetry.angleDegrees
          })
        }
      }
      track('leftStickClick')
      track('rightStickClick')
    },
    [gestureEngine, stickRotation]
  )

  const queueControllerRender = useCallback(
    (snapshot?: ControllerSnapshot, event?: ControllerEventEntry): void => {
      if (snapshot) {
        controllerActiveValuesRef.current = snapshot.activeValues
        notifyActiveValues()
        pendingControllerRef.current = snapshot
        feedStickRotation(snapshot.activeValues)
      }
      if (event) {
        const previous = lastQueuedControllerEventRef.current
        if (
          previous?.input !== event.input ||
          previous.value !== event.value ||
          previous.pressed !== event.pressed ||
          previous.source !== event.source
        ) {
          pendingControllerEventsRef.current.push(event)
          lastQueuedControllerEventRef.current = event
        }
      }
      if (controllerRenderFrameRef.current === null) {
        controllerRenderFrameRef.current = window.requestAnimationFrame(flushControllerRender)
      }
    },
    [feedStickRotation, flushControllerRender, notifyActiveValues]
  )

  /**
   * The only way the active layer should ever change from the gesture pipeline.
   *
   * State alone is not enough: `activeLayerRef` is what resolution reads, and
   * several gestures can arrive before React commits, so a shift written only
   * through `setActiveLayer` (and mirrored in a layout effect) is invisible to
   * the very presses it exists to redirect.
   */
  const applyActiveLayer = useCallback((layer: MappingLayer): void => {
    activeLayerRef.current = layer
    setActiveLayer(layer)
  }, [])

  /**
   * The bridge's haptic engine knows four tones and only `success` was ever
   * asked for, so the three that carry information the screen cannot — a shift
   * that changed what every control does, and a dispatch that failed while the
   * user was looking at Codex — were silent.
   */
  const playFeedbackTone = useCallback((tone: FeedbackTone): void => {
    const profile = libraryRef.current.profiles.find(
      (candidate) => candidate.id === libraryRef.current.activeProfileId
    )
    if (!profile?.hapticsEnabled) return
    void window.controllerControls.native.send('haptics.play', { tone })
  }, [])

  const engageLayerShift = useCallback(
    (input: ControllerInputId, layer: MappingLayer): void => {
      layerShiftHoldsRef.current.set(input, layer)
      applyActiveLayer(layer)
      // Entering a layer is the one state change with no on-screen counterpart
      // while the user is looking at Codex: the controls under their thumbs all
      // mean something else now.
      playFeedbackTone('layer')
    },
    [applyActiveLayer, playFeedbackTone]
  )

  /** Falls back to whichever shift is still held, and only then to base. */
  const releaseLayerShift = useCallback(
    (input: ControllerInputId): void => {
      layerShiftHoldsRef.current.delete(input)
      const stillHeld = [...layerShiftHoldsRef.current.values()]
      applyActiveLayer(stillHeld[stillHeld.length - 1] ?? 'base')
    },
    [applyActiveLayer]
  )

  const resetControllerInputState = useCallback((snapshot?: ControllerSnapshot): void => {
    // Releases the presses instead of forgetting them. Blur is the *normal* end
    // of a push-to-talk press — the binding focuses Codex, which blurs this
    // window — and a hold dropped without its `holdEnded` leaves ⌃⇧D physically
    // down, so dictation never stops.
    gestureEngine.reset()
    stickRotation.left.reset()
    stickRotation.right.reset()
    layerShiftHoldsRef.current.clear()
    activeLayerRef.current = 'base'
    setActiveLayer('base')
    pendingControllerRef.current = null
    pendingControllerEventsRef.current = []
    lastQueuedControllerEventRef.current = null
    controllerActiveValuesRef.current = {}
    notifyActiveValues()
    if (controllerRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(controllerRenderFrameRef.current)
      controllerRenderFrameRef.current = null
    }
    const nextController = withoutActiveInputs(snapshot ?? controllerMetadataRef.current)
    controllerMetadataRef.current = nextController
    setController(nextController)
  }, [gestureEngine, notifyActiveValues, stickRotation])

  /**
   * Recomputes the dispatch gate from its two sources.
   *
   * Entering suspension releases whatever is held first: once the ref is true
   * the gesture handler drops everything, and the thing it would drop is the
   * `holdEnded` that puts a held key back up.
   */
  const applyMappingSuspension = useCallback((): void => {
    const suspended = recordingSuspendedRef.current || bridgeSuspendedRef.current
    if (suspended === mappingsSuspendedRef.current) return
    if (suspended) resetControllerInputState()
    mappingsSuspendedRef.current = suspended
    setMappingsSuspended(suspended)
  }, [resetControllerInputState])

  useEffect(() => {
    // The shortcut recorder claims a suspension for as long as it is listening
    // for a keystroke; see core/inputSuspension.
    recordingSuspendedRef.current = controllerInputSuspension.suspended
    applyMappingSuspension()
    return controllerInputSuspension.subscribe((suspended) => {
      recordingSuspendedRef.current = suspended
      applyMappingSuspension()
    })
  }, [applyMappingSuspension])

  useEffect(() => {
    if (section !== 'diagnostics') return
    setControllerEvents(controllerEventsRef.current)
    setStickDiagnostics(stickDiagnosticsRef.current)
    setRotationTrace(rotationTraceRef.current)
  }, [section])

  useEffect(
    () => () => {
      // `cancel`, not `reset`: there is nothing left to dispatch a release to
      // once the hook is gone, and a pending tap that fires after teardown
      // would resolve against a profile nobody is looking at any more.
      gestureEngine.cancel()
      if (controllerRenderFrameRef.current !== null) {
        window.cancelAnimationFrame(controllerRenderFrameRef.current)
      }
      if (transientLightTimerRef.current !== null) {
        window.clearTimeout(transientLightTimerRef.current)
      }
    },
    [gestureEngine]
  )

  /**
   * Loads the saved library, and — this is the part that matters — leaves
   * autosave switched off when the load fails.
   *
   * A rejected load means the file on disk is unreadable but very possibly
   * recoverable. The hook still shows the in-memory defaults so the app is usable,
   * but `libraryLoadedRef` stays false, so the first edit cannot autosave those
   * defaults over the file. Autosave comes back only when the user explicitly
   * asks for it: `retryProfileLoad`, `resetToDefaults` (start fresh), or an
   * import.
   */
  const loadProfiles = useCallback(async (): Promise<void> => {
    try {
      const value = await window.controllerControls.profiles.load()
      savedLibraryRef.current = structuredClone(value)
      libraryLoadedRef.current = true
      setProfileLoadError(null)
      setAutosaveState('saved')
      setAutosaveMessage('All changes saved')
      setLibrary(value)
      // Deliberately selects nothing. Opening the editor on whichever binding
      // happens to sit first in the profile — the D-pad, as it turns out —
      // presents an arbitrary control as though the user had chosen it, and
      // invites an edit to something they never clicked. The editor has a
      // first-class empty state; this lets it be the honest starting point.
      setSelectedInput(null)
      setSelectedBindingId(null)
      setDraftBinding(null)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'The saved profile library could not be read.'
      libraryLoadedRef.current = false
      setProfileLoadError(message)
      setAutosaveState('error')
      setAutosaveMessage('Profiles could not be loaded — changes will not be saved')
      toast.error('Profiles could not be loaded', {
        description: `${message} Changes are not being saved.`,
        // Stays up: it is the only route back to saving, so it must not slide
        // away before the user has read it.
        duration: Infinity,
        action: { label: 'Try again', onClick: () => void loadProfiles() }
      })
    }
  }, [])

  useEffect(() => {
    void loadProfiles()
    void window.controllerControls.system.snapshot().then(setSystem)
  }, [loadProfiles])

  useEffect(() => {
    void window.controllerControls.native.send('system.refresh')
    const timer = window.setInterval(() => {
      void window.controllerControls.native.send('system.refresh')
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const unsubscribe = window.controllerControls.native.subscribe((event: NativeBridgeEvent) => {
      if (event.type === 'controller') {
        const snapshot = event.payload as ControllerSnapshot
        // The bridge stops forwarding input while it verifies the microphone and
        // says so in the snapshot. Honouring it here is what keeps a press made
        // during that window from dispatching when the events resume.
        bridgeSuspendedRef.current = snapshot.inputSuspended === true
        applyMappingSuspension()
        nativeControllerSeen.current = snapshot.connected
        // While the native bridge owns the controller the Web Gamepad snapshot
        // is discarded, so stop polling it every animation frame.
        if (snapshot.connected) gamepadServiceRef.current?.suspend()
        else gamepadServiceRef.current?.resume()
        if (!snapshot.connected) {
          resetControllerInputState(snapshot)
          controllerWasConnected.current = false
          return
        }
        let entry: ControllerEventEntry | undefined
        if (snapshot.lastInput && !mappingsSuspendedRef.current) {
          const input = snapshot.lastInput
          const value = snapshot.activeValues[input] ?? 0
          const timestamp = performance.now() / 1_000
          if (
            snapshot.lastPressed !== undefined &&
            !(input === 'touchpad' && snapshot.touchpadPointerStatus === 'ready')
          ) {
            gestureEngine.consume({
              input,
              value,
              pressed: snapshot.lastPressed,
              timestamp
            })
          }
          entry = {
            id: crypto.randomUUID(),
            input,
            value,
            pressed: snapshot.lastPressed ?? value >= axisThresholdsRef.current.enter,
            timestamp,
            source: 'native'
          }
        }
        queueControllerRender(snapshot, entry)
      } else if (event.type === 'permission') {
        const snapshot = event.payload as SystemSnapshot
        setSystem((current) => ({
          ...(current ?? snapshot),
          ...snapshot,
          appVersion: current?.appVersion ?? snapshot.appVersion,
          // This event came *from* the bridge, so the bridge is running.
          // Merging `current ?? snapshot` let whichever value won the startup
          // race stand for the whole session, which is how a bridge that came
          // up a moment after the first system snapshot kept a permanent
          // "Native bridge is not running" banner on Diagnostics.
          nativeBridgeAvailable: true
        }))
      } else if (event.type === 'error') {
        toast.error('Native bridge', {
          description: (event.payload as { message: string }).message
        })
      }
    })
    return unsubscribe
  }, [applyMappingSuspension, gestureEngine, queueControllerRender, resetControllerInputState])

  useEffect(() => {
    const service = new GamepadService(
      (snapshot) => {
        if (mappingsSuspendedRef.current) return
        if (nativeControllerSeen.current) return
        if (!snapshot.connected) {
          resetControllerInputState(snapshot)
          controllerWasConnected.current = false
          return
        }
        queueControllerRender(snapshot)
      },
      (event) => {
        if (mappingsSuspendedRef.current) return
        if (nativeControllerSeen.current) return
        gestureEngine.consume(event)
        queueControllerRender(undefined, {
          id: crypto.randomUUID(),
          input: event.input,
          value: event.value,
          pressed: event.pressed,
          timestamp: event.timestamp,
          source: 'gamepad'
        })
      },
      axisThresholdsRef.current
    )
    gamepadServiceRef.current = service
    service.start()
    // A native controller event can land before this effect runs, so honour the
    // already-observed state rather than waiting for the next one.
    if (nativeControllerSeen.current) service.suspend()
    return () => service.stop()
  }, [gestureEngine, queueControllerRender, resetControllerInputState])

  useEffect(() => {
    const clearInterruptedInput = (): void => {
      resetControllerInputState()
      gamepadServiceRef.current?.reset()
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') clearInterruptedInput()
    }
    const refreshOnFocus = (): void => {
      clearInterruptedInput()
      void window.controllerControls.native.send('system.refresh')
    }
    window.addEventListener('blur', clearInterruptedInput)
    window.addEventListener('focus', refreshOnFocus)
    window.addEventListener('pagehide', clearInterruptedInput)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', clearInterruptedInput)
      window.removeEventListener('focus', refreshOnFocus)
      window.removeEventListener('pagehide', clearInterruptedInput)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [resetControllerInputState])

  useEffect(() => {
    const engine = gestureEngine
    engine.layerAtPress = () => activeLayerRef.current
    engine.shouldRecognizeChord = (first, second, pressedLayer) => {
      const profile = libraryRef.current.profiles.find(
        (candidate) => candidate.id === libraryRef.current.activeProfileId
      )
      if (!profile) return false
      return Boolean(
        resolveBinding(
          {
            input: first,
            secondaryInput: second,
            kind: 'chord',
            timestamp: performance.now() / 1_000,
            layer: pressedLayer
          },
          profile,
          pressedLayer ?? activeLayerRef.current
        )
      )
    }
    engine.onGesture = (gesture) => {
      if (!enabledRef.current || mappingsSuspendedRef.current) return
      const profile =
        libraryRef.current.profiles.find(
          (candidate) => candidate.id === libraryRef.current.activeProfileId
        ) ?? libraryRef.current.profiles[0]
      if (!profile) return
      // The layer a press began in, not the one that happens to be active when
      // the gesture is emitted: a tap waits out the double-tap window, and a
      // hold's release can arrive after the shift that was held for it is gone.
      const layer = gesture.layer ?? activeLayerRef.current
      // A shift is released by the control that engaged it, whatever layer that
      // control's own binding lives in, and only that one.
      if (gesture.kind === 'holdEnded' && layerShiftHoldsRef.current.has(gesture.input)) {
        releaseLayerShift(gesture.input)
        return
      }
      const activeHold =
        gesture.kind === 'holdEnded'
          ? activeHoldShortcutsRef.current.get(gesture.input)
          : undefined
      const binding = activeHold ?? resolveBinding(gesture, profile, layer)
      if (!binding) return
      if (activeHold) activeHoldShortcutsRef.current.delete(gesture.input)
      if (binding.action.type === 'layerShift' && binding.action.targetLayer) {
        if (gesture.kind === 'holdBegan') engageLayerShift(gesture.input, binding.action.targetLayer)
        if (gesture.kind === 'holdEnded') releaseLayerShift(gesture.input)
        return
      }
      if (gesture.kind === 'holdBegan' && binding.action.type === 'holdShortcut') {
        // Written before execute: focusing Codex normally blurs this window while
        // key-down is still in flight, and that blur must already know what to
        // release.
        activeHoldShortcutsRef.current.set(gesture.input, structuredClone(binding))
      }
      setSelectedInput(binding.input)
      setSelectedBindingId(binding.id)

      pendingActionCountRef.current += 1
      setIsActionRunning(true)
      void window.controllerControls.actions
        .execute({
          bindingId: binding.id,
          action: binding.action,
          focusPolicy: binding.focusPolicy,
          safety: binding.safety,
          gesture: gesture.kind,
          confirmationPolicy: profile.consequentialConfirmationPolicy
        })
        .then((result) => {
          // The bridge can report that a key was posted; it cannot report that
          // Codex acted on it. For a command Codex registers with no default
          // binding, a posted key is a no-op until the user binds it, so a
          // plain success here would claim something that did not happen.
          const unbound = unacknowledgedCodexCommand(
            binding.action,
            codexBindingsConfirmedRef.current
          )
          const succeeded = result.status === 'success' && !unbound
          setTransientLight(succeeded ? 'success' : 'failure')
          // Re-arm rather than stacking a timer per dispatched action.
          if (transientLightTimerRef.current !== null) {
            window.clearTimeout(transientLightTimerRef.current)
          }
          transientLightTimerRef.current = window.setTimeout(() => {
            transientLightTimerRef.current = null
            setTransientLight(undefined)
          }, 1_200)
          if (result.status === 'permissionNeeded') {
            toast.error('Accessibility access is required', {
              description: result.message,
              action: {
                label: 'Open Settings',
                onClick: () =>
                  void window.controllerControls.system.openSettings('accessibility')
              }
            })
          }
          if (unbound && result.status === 'success') {
            toast.warning(`Codex has no shortcut bound to ${unbound.commandId}`, {
              description: `${binding.action.title} sent ${formatShortcut(unbound.shortcut)}, but Codex ships this command unbound, so nothing happened. Bind it in Codex with ⌘/, then mark it done in Settings.`
            })
          }
          if (profile.overlayEnabled) {
            void window.controllerControls.actions.showOverlay(
              unbound ? `${binding.action.title} — not bound in Codex` : binding.action.title,
              unbound ? `Sent ${formatShortcut(unbound.shortcut)}. Codex has nothing bound to it.` : result.message,
              succeeded ? 'success' : 'failure'
            )
          }
          if (succeeded) {
            if (profile.hapticsEnabled) gamepadServiceRef.current?.pulse()
            playFeedbackTone('success')
          } else {
            // A failed dispatch is exactly the case the user cannot see: the
            // window they are looking at is Codex, and nothing happened in it.
            playFeedbackTone('failure')
          }
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'The mapped action could not be dispatched.'
          setTransientLight('failure')
          if (transientLightTimerRef.current !== null) {
            window.clearTimeout(transientLightTimerRef.current)
          }
          transientLightTimerRef.current = window.setTimeout(() => {
            transientLightTimerRef.current = null
            setTransientLight(undefined)
          }, 1_200)
          toast.error('Mapped action failed', { description: message })
          playFeedbackTone('failure')
        })
        .finally(() => {
          pendingActionCountRef.current = Math.max(0, pendingActionCountRef.current - 1)
          if (pendingActionCountRef.current === 0) setIsActionRunning(false)
        })
    }
  }, [engageLayerShift, gestureEngine, playFeedbackTone, releaseLayerShift])

  /**
   * Re-read Codex's keymap whenever what we need bound changes, and whenever
   * the window regains focus.
   *
   * The focus half matters as much as the profile half: the user can change a
   * binding in Codex's own Keyboard Shortcuts at any time, and there is no file
   * watcher on the keymap. Coming back to this window is the moment that drift
   * would otherwise go unnoticed and the status would keep asserting something
   * that is no longer true.
   */
  const codexSignature = codexBindingSignature(activeProfile ?? null)
  useEffect(() => {
    void refreshCodexKeymap()
  }, [codexSignature, refreshCodexKeymap])

  useEffect(() => {
    const onFocus = (): void => void refreshCodexKeymap()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshCodexKeymap])

  useEffect(() => {
    window.localStorage.setItem(
      experimentalMicrophonePreferenceKey,
      String(experimentalDualSenseMicrophoneEnabled)
    )
    void window.controllerControls.native.send('audio.configure', {
      experimentalDualSenseMicrophoneEnabled
    })
  }, [experimentalDualSenseMicrophoneEnabled])

  const setExperimentalDualSenseMicrophoneEnabled = useCallback((enabled: boolean): void => {
    setExperimentalMicrophoneState(enabled)
  }, [])

  useEffect(() => {
    if (controller.connected) {
      controllerWasConnected.current = true
      return
    }
    if (controllerWasConnected.current) {
      // A controller that vanishes mid-hold has the same problem a blur does:
      // the key-down is already out there, so the press is released rather than
      // forgotten.
      gestureEngine.reset()
      layerShiftHoldsRef.current.clear()
      applyActiveLayer('base')
      controllerWasConnected.current = false
    }
  }, [applyActiveLayer, controller.connected, gestureEngine])

  const setControllerEnabled = useCallback(
    (enabled: boolean): void => {
      if (!enabled) {
        resetControllerInputState()
        gamepadServiceRef.current?.reset()
      }
      setIsEnabled(enabled)
    },
    [resetControllerInputState]
  )

  const lightStatus: ControllerLightStatus = dominantLightStatus({
    hasRunningActions: isActionRunning,
    needsAttention: !controller.connected,
    isCodexRunning: Boolean(system?.codexRunning) && isEnabled,
    transient: transientLight
  })

  useEffect(() => {
    const color = lightColors[lightStatus]
    void window.controllerControls.native.send('light.set', { status: lightStatus, color })
  }, [lightStatus])

  useEffect(() => {
    // The same pair the bridge is configured with, so the Web Gamepad fallback
    // reads the sticks the way the profile says rather than off a constant.
    axisThresholdsRef.current = {
      enter: activeProfile.axisEnterThreshold,
      release: activeProfile.axisReleaseThreshold
    }
    gamepadServiceRef.current?.setAxisThresholds(axisThresholdsRef.current)
    gamepadServiceRef.current?.setTriggerThresholds({
      enter: activeProfile.triggerEnterThreshold,
      release: activeProfile.triggerReleaseThreshold
    })
    void window.controllerControls.native.send('controller.configure', {
      axisEnterThreshold: activeProfile.axisEnterThreshold,
      axisReleaseThreshold: activeProfile.axisReleaseThreshold,
      triggerEnterThreshold: activeProfile.triggerEnterThreshold,
      triggerReleaseThreshold: activeProfile.triggerReleaseThreshold,
      touchpadPointerEnabled: activeProfile.touchpadPointerEnabled && isEnabled,
      touchpadPointerSpeed: activeProfile.touchpadPointerSpeed
    })
  }, [
    activeProfile.axisEnterThreshold,
    activeProfile.axisReleaseThreshold,
    activeProfile.triggerEnterThreshold,
    activeProfile.triggerReleaseThreshold,
    activeProfile.touchpadPointerEnabled,
    activeProfile.touchpadPointerSpeed,
    isEnabled
  ])

  /**
   * Records invocation order at the point the IPC message is sent.
   *
   * The main process serializes repository writes in that same order. Keeping
   * the last requested snapshot here lets the unload path avoid posting the
   * same library for `beforeunload`, `pagehide`, and React cleanup while still
   * posting a reverted snapshot after an older save that is already in flight.
   */
  const requestProfileSave = useCallback(
    (snapshot: ProfileLibrary, serialized: string): Promise<ProfileLibrary> => {
      const existing = lastAutosaveRequestRef.current
      if (existing?.serialized === serialized) return existing.promise

      const request = {
        id: autosaveRequestCounterRef.current + 1,
        serialized,
        promise: Promise.resolve(snapshot)
      }
      autosaveRequestCounterRef.current = request.id

      let pending: Promise<ProfileLibrary>
      try {
        // Invoke synchronously. On unload, merely scheduling this call in a
        // microtask would let the renderer disappear before IPC sees it.
        pending = window.controllerControls.profiles.save(snapshot)
      } catch (error) {
        if (lastAutosaveRequestRef.current?.id === request.id) {
          lastAutosaveRequestRef.current = null
        }
        return Promise.reject(error)
      }

      request.promise = pending.catch((error: unknown) => {
        if (lastAutosaveRequestRef.current?.id === request.id) {
          lastAutosaveRequestRef.current = null
        }
        throw error
      })
      lastAutosaveRequestRef.current = request
      return request.promise
    },
    []
  )

  /**
   * Saves the newest valid snapshot and resolves only once that exact request
   * has completed.
   *
   * It deliberately bypasses the debounce, but it does not bypass an identical
   * in-flight save: `requestProfileSave` returns that request's real promise.
   * If an older, different snapshot is or was last requested, this registers
   * the current one behind it before the first await, preserving latest-wins
   * ordering in the main repository.
   */
  const flushCurrentProfile = useCallback(async (): Promise<void> => {
    if (!libraryLoadedRef.current) return

    const snapshot = structuredClone(libraryRef.current)
    const serialized = JSON.stringify(snapshot)
    const savedSerialized = JSON.stringify(savedLibraryRef.current)
    const lastRequest = lastAutosaveRequestRef.current
    if (serialized === savedSerialized && !lastRequest) return

    const issue = profileAutosaveIssue(snapshot)
    if (issue) throw new Error(issue)

    // A different last request may have put an older snapshot on disk even
    // when this snapshot equals `savedLibraryRef` (the Revert-during-save case).
    // Registering the current snapshot again is what makes it final.
    const saved = await requestProfileSave(snapshot, serialized)
    if (JSON.stringify(libraryRef.current) === serialized) {
      savedLibraryRef.current = structuredClone(saved)
    }
  }, [requestProfileSave])

  /**
   * The ordinary close/pagehide path remains best effort because the renderer
   * may disappear immediately. Cmd-Q uses the explicit acknowledged listener
   * below instead, while the main process is keeping the window alive.
   */
  const flushAutosaveBeforeExit = useCallback((): void => {
    void flushCurrentProfile().catch(() => undefined)
  }, [flushCurrentProfile])

  useEffect(() => {
    window.addEventListener('beforeunload', flushAutosaveBeforeExit)
    window.addEventListener('pagehide', flushAutosaveBeforeExit)
    return () => {
      window.removeEventListener('beforeunload', flushAutosaveBeforeExit)
      window.removeEventListener('pagehide', flushAutosaveBeforeExit)
      flushAutosaveBeforeExit()
    }
  }, [flushAutosaveBeforeExit])

  useEffect(
    () =>
      window.controllerControls.profiles.onFlushRequested(async () => {
        // Freeze first, then save until the snapshot observed after the await
        // is the one we registered. The loop covers a React update that was
        // already queued immediately before the IPC request arrived.
        profileEditsAcceptedRef.current = false
        for (;;) {
          const serialized = JSON.stringify(libraryRef.current)
          await flushCurrentProfile()
          if (JSON.stringify(libraryRef.current) === serialized) return
        }
      }),
    [flushCurrentProfile]
  )

  useEffect(() => {
    // False until a load has actually produced the on-disk library. Saving
    // before that — or after a load failure, when this stays false — would write
    // the in-memory defaults over a file that is still there to be recovered.
    if (!libraryLoadedRef.current) return

    const serialized = JSON.stringify(library)
    if (serialized === JSON.stringify(savedLibraryRef.current)) {
      if (autosaveInFlightRef.current) {
        setAutosaveState('saving')
        setAutosaveMessage('Saving changes…')
        return
      }
      lastAutosaveErrorRef.current = null
      setAutosaveState('saved')
      setAutosaveMessage('All changes saved')
      return
    }

    const issue = profileAutosaveIssue(library)
    if (issue) {
      setAutosaveState('invalid')
      setAutosaveMessage(issue)
      return
    }

    setAutosaveState('pending')
    setAutosaveMessage('Changes will save automatically')
    const snapshot = structuredClone(library)
    const timer = window.setTimeout(() => {
      autosaveQueueRef.current = autosaveQueueRef.current.then(async () => {
        if (JSON.stringify(libraryRef.current) !== serialized) return
        autosaveInFlightRef.current = true
        setAutosaveState('saving')
        setAutosaveMessage('Saving changes…')
        try {
          let nextSnapshot = snapshot
          let nextSerialized = serialized
          for (;;) {
            if (JSON.stringify(savedLibraryRef.current) !== nextSerialized) {
              const saved = await requestProfileSave(nextSnapshot, nextSerialized)
              savedLibraryRef.current = structuredClone(saved)
            }
            lastAutosaveErrorRef.current = null

            const latestSerialized = JSON.stringify(libraryRef.current)
            if (latestSerialized === nextSerialized) {
              setAutosaveState('saved')
              setAutosaveMessage('All changes saved')
              break
            }

            // A save can finish after Revert or a newer edit. Persist that latest
            // valid snapshot in the same queue turn so the stale completion can
            // never become the final disk state.
            const latestIssue = profileAutosaveIssue(libraryRef.current)
            if (latestIssue) {
              setAutosaveState('invalid')
              setAutosaveMessage(latestIssue)
              break
            }
            nextSnapshot = structuredClone(libraryRef.current)
            nextSerialized = latestSerialized
            setAutosaveMessage('Saving newer changes…')
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Resolve invalid or duplicate mappings.'
          setAutosaveState('error')
          setAutosaveMessage('Autosave failed')
          if (lastAutosaveErrorRef.current !== message) {
            lastAutosaveErrorRef.current = message
            toast.error('Changes could not be saved automatically', {
              description: message
            })
          }
        } finally {
          autosaveInFlightRef.current = false
        }
      })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [autosaveQueueRef, library, requestProfileSave])

  const selectInput = useCallback(
    (input: ControllerInputId): void => {
      const profile =
        libraryRef.current.profiles.find(
          (candidate) => candidate.id === libraryRef.current.activeProfileId
        ) ?? libraryRef.current.profiles[0]
      const existing =
        profile.bindings.find(
          (binding) => binding.input === input && binding.layer === activeLayerRef.current
        ) ??
        profile.bindings.find((binding) => binding.input === input && binding.layer === 'base')
      setSelectedInput(input)
      if (existing) {
        setSelectedBindingId(existing.id)
        return
      }
      // The layer that is actually in force, exactly as `addBinding` stamps it.
      // Hard-coding `base` here meant a control picked while a layer was held
      // opened an editor that quietly wrote to a different layer than the one
      // the switcher was showing.
      const created = { ...createUnassignedBinding(input), layer: activeLayerRef.current }
      setDraftBinding(created)
      setSelectedBindingId(created.id)
    },
    []
  )

  const deselectInput = useCallback((): void => {
    setSelectedInput(null)
    setSelectedBindingId(null)
    setDraftBinding(null)
  }, [])

  const updateSelectedBinding = useCallback(
    (update: Partial<ControllerBinding>): void => {
      if (!selectedBinding) return
      // The first real edit is what commits the draft. Until then nothing about
      // the library has changed, so nothing is saved.
      if (draftBinding && selectedBinding.id === draftBinding.id) {
        const committed = { ...draftBinding, ...update }
        setDraftBinding(null)
        setLibrary((current) => ({
          ...current,
          profiles: current.profiles.map((profile) =>
            profile.id === current.activeProfileId
              ? { ...profile, bindings: [...profile.bindings, committed] }
              : profile
          )
        }))
        setSelectedBindingId(committed.id)
        if (update.input) setSelectedInput(update.input)
        return
      }
      setLibrary((current) => ({
        ...current,
        profiles: current.profiles.map((profile) =>
          profile.id === current.activeProfileId
            ? {
                ...profile,
                bindings: profile.bindings.map((binding) =>
                  binding.id === selectedBinding.id ? { ...binding, ...update } : binding
                )
              }
            : profile
        )
      }))
      if (update.input) setSelectedInput(update.input)
    },
    [draftBinding, selectedBinding]
  )

  const selectBinding = useCallback(
    (binding: ControllerBinding): void => {
      setSelectedInput(binding.input)
      setSelectedBindingId(binding.id)
      applyActiveLayer(binding.layer)
    },
    [applyActiveLayer]
  )

  const addBinding = useCallback((): void => {
    const profile = libraryRef.current.profiles.find(
      (candidate) => candidate.id === libraryRef.current.activeProfileId
    )
    if (!profile || profile.bindings.length >= profileLimits.bindings) {
      toast.error(`A profile can contain at most ${profileLimits.bindings} mappings`)
      return
    }
    const input =
      selectedInput && selectedInput !== 'share'
        ? selectedInput
        : pickableControllerInputIds[0]
    if (!input) return
    const created = createUnassignedBinding(input)
    created.layer = activeLayerRef.current
    setLibrary((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === current.activeProfileId
          ? { ...profile, bindings: [...profile.bindings, created] }
          : profile
      )
    }))
    setSelectedInput(input)
    setSelectedBindingId(created.id)
  }, [selectedInput])

  const deleteSelectedBinding = useCallback((): void => {
    if (!selectedBinding) return
    // An uncommitted draft is not in the library, so deleting it is just
    // dropping it — filtering the profile would remove nothing and then move
    // the selection onto some unrelated binding.
    if (draftBinding && selectedBinding.id === draftBinding.id) {
      setDraftBinding(null)
      setSelectedBindingId(null)
      return
    }
    const profiles = library.profiles.map((profile) => {
      if (profile.id !== library.activeProfileId) return profile
      return {
        ...profile,
        bindings: profile.bindings.filter((binding) => binding.id !== selectedBinding.id)
      }
    })
    const active = profiles.find((profile) => profile.id === library.activeProfileId)
    const next = active?.bindings[0] ?? null
    setLibrary({ ...library, profiles })
    setSelectedBindingId(next?.id ?? null)
    setSelectedInput(next?.input ?? null)
  }, [draftBinding, library, selectedBinding])

  const revertLibrary = useCallback((): void => {
    const saved = structuredClone(savedLibraryRef.current!)
    setLibrary(saved)
    const profile =
      saved.profiles.find((candidate) => candidate.id === saved.activeProfileId) ??
      saved.profiles[0]
    const first = profile?.bindings[0]
    setSelectedBindingId(first?.id ?? null)
    setSelectedInput(first?.input ?? null)
    toast.message('Draft changes reverted')
  }, [])

  const importLibrary = useCallback(async (): Promise<void> => {
    try {
      const imported = await window.controllerControls.profiles.import(libraryRef.current)
      if (!imported) return
      savedLibraryRef.current = structuredClone(imported)
      // Choosing a file is explicit enough to re-arm autosave after a failed load.
      libraryLoadedRef.current = true
      setProfileLoadError(null)
      setLibrary(imported)
      const profile =
        imported.profiles.find((candidate) => candidate.id === imported.activeProfileId) ??
        imported.profiles[0]
      const first = profile?.bindings[0]
      setSelectedBindingId(first?.id ?? null)
      setSelectedInput(first?.input ?? null)
      toast.success(profile ? `Imported “${profile.name}”` : 'Profile imported', {
        description: 'Your existing profiles were kept.'
      })
    } catch (error) {
      toast.error('Import failed', {
        description: error instanceof Error ? error.message : 'The file is not a valid profile.'
      })
    }
  }, [])

  const exportLibrary = useCallback(async (): Promise<void> => {
    try {
      const active = libraryRef.current.profiles.find(
        (profile) => profile.id === libraryRef.current.activeProfileId
      )
      if (!active) throw new Error('The active profile could not be found.')
      const exported = await window.controllerControls.profiles.export(active)
      if (exported) toast.success(`Exported “${active.name}”`)
    } catch (error) {
      toast.error('Export failed', {
        description: error instanceof Error ? error.message : 'The profile could not be written.'
      })
    }
  }, [])

  /**
   * Doubles as the "start fresh" answer to a failed load: it is an explicit
   * choice to discard whatever is on disk, so it re-arms autosave.
   */
  const resetToDefaults = useCallback((): void => {
    const profile = createDefaultProfile()
    const next: ProfileLibrary = {
      schemaVersion: 1,
      activeProfileId: profile.id,
      profiles: [profile]
    }
    libraryLoadedRef.current = true
    setProfileLoadError(null)
    setLibrary(next)
    setSelectedBindingId(profile.bindings[0]?.id ?? null)
    setSelectedInput(profile.bindings[0]?.input ?? 'buttonA')
    applyActiveLayer('base')
    toast.message('Defaults restored', {
      description: 'The restored library will save automatically.'
    })
  }, [applyActiveLayer])

  const selectProfile = useCallback(
    (profileId: string): void => {
      setLibrary((current) => ({ ...current, activeProfileId: profileId }))
      const profile = libraryRef.current.profiles.find((candidate) => candidate.id === profileId)
      const first = profile?.bindings[0]
      setSelectedBindingId(first?.id ?? null)
      setSelectedInput(first?.input ?? null)
      applyActiveLayer('base')
    },
    [applyActiveLayer]
  )

  const duplicateProfile = useCallback((): void => {
    if (libraryRef.current.profiles.length >= profileLimits.profiles) {
      toast.error(`A library can contain at most ${profileLimits.profiles} profiles`)
      return
    }
    const source =
      libraryRef.current.profiles.find(
        (candidate) => candidate.id === libraryRef.current.activeProfileId
      ) ?? libraryRef.current.profiles[0]
    if (!source) return
    const id = crypto.randomUUID()
    const profile: MappingProfile = {
      ...structuredClone(source),
      id,
      name: duplicateProfileName(source.name),
      bindings: source.bindings.map((binding) => ({ ...structuredClone(binding), id: crypto.randomUUID() }))
    }
    setLibrary((current) => ({
      ...current,
      activeProfileId: id,
      profiles: [...current.profiles, profile]
    }))
    setSelectedBindingId(profile.bindings[0]?.id ?? null)
    setSelectedInput(profile.bindings[0]?.input ?? null)
  }, [])

  /**
   * Adds the Micro companion profile beside whatever the user already has and
   * switches to it. It is never written over an existing profile: the point of
   * shipping it as an opt-in is that the verified mappings stay verified. If it
   * is already in the library this just selects it rather than growing a pile
   * of copies.
   */
  const addMicroCompanionProfile = useCallback((): void => {
    const existing = libraryRef.current.profiles.find(
      (candidate) => candidate.name === MICRO_PROFILE_NAME
    )
    if (existing) {
      selectProfile(existing.id)
      toast.info(`${MICRO_PROFILE_NAME} is already in this library`)
      return
    }
    if (libraryRef.current.profiles.length >= profileLimits.profiles) {
      toast.error(`A library can contain at most ${profileLimits.profiles} profiles`)
      return
    }
    const profile = createMicroCompanionProfile()
    setLibrary((current) => ({
      ...current,
      activeProfileId: profile.id,
      profiles: [...current.profiles, profile]
    }))
    setSelectedBindingId(profile.bindings[0]?.id ?? null)
    if (profile.bindings[0]) setSelectedInput(profile.bindings[0].input)
    applyActiveLayer('base')
    toast.success(`Added ${MICRO_PROFILE_NAME}`)
  }, [applyActiveLayer, selectProfile])

  const setMicroDialMode = useCallback((mode: MicroDialMode): void => {
    setLibrary((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === current.activeProfileId ? withMicroDialMode(profile, mode) : profile
      )
    }))
    setSelectedBindingId(null)
  }, [])

  const deleteActiveProfile = useCallback((): void => {
    if (library.profiles.length <= 1) {
      toast.error('At least one profile is required')
      return
    }
    const profiles = library.profiles.filter((profile) => profile.id !== library.activeProfileId)
    const next = profiles[0]
    if (!next) return
    setLibrary({ ...library, activeProfileId: next.id, profiles })
    setSelectedBindingId(next.bindings[0]?.id ?? null)
    setSelectedInput(next.bindings[0]?.input ?? null)
  }, [library])

  const updateActiveProfile = useCallback((update: Partial<MappingProfile>): void => {
    setLibrary((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === current.activeProfileId ? { ...profile, ...update } : profile
      )
    }))
  }, [])

  const testSelectedAction = useCallback(async (): Promise<void> => {
    if (!selectedBinding) return
    const request = {
      bindingId: selectedBinding.id,
      action: selectedBinding.action,
      focusPolicy: selectedBinding.focusPolicy,
      safety: selectedBinding.safety,
      confirmationPolicy: activeProfile.consequentialConfirmationPolicy
    }
    /**
     * A `holdShortcut` posts one half of a keystroke per gesture: key-down for
     * `holdBegan`, key-up for `holdEnded`. Testing such a binding on its own
     * gesture therefore either left the key physically down for the rest of the
     * session — ⌃⇧D stuck is dictation that never stops — or posted a bare
     * key-up for nothing. A test has to be the whole press, so it sends both
     * halves whichever half the binding itself is.
     */
    const isHold = selectedBinding.action.type === 'holdShortcut'
    const result = await window.controllerControls.actions.execute({
      ...request,
      gesture: isHold ? 'holdBegan' : selectedBinding.gesture
    })
    if (isHold) {
      // Released even when the press reported a failure: the key-down may still
      // have landed, and an unreleased modifier is worse than a redundant key-up.
      await window.controllerControls.actions.execute({ ...request, gesture: 'holdEnded' })
    }
    if (result.status === 'success') {
      toast.success('Test action dispatched', { description: result.message })
    } else if (result.status === 'permissionNeeded') {
      toast.error('Accessibility access is required', {
        description: result.message,
        action: {
          label: 'Open Settings',
          onClick: () => void window.controllerControls.system.openSettings('accessibility')
        }
      })
    } else {
      toast.error('Test action did not run', { description: result.message })
    }
  }, [activeProfile.consequentialConfirmationPolicy, selectedBinding])

  const refreshSystem = useCallback(async (): Promise<void> => {
    setSystem(await window.controllerControls.system.refresh())
  }, [])

  const verifyUSBControllerSpeaker = useCallback(async (): Promise<void> => {
    if (isSpeakerTestRunning) return
    setIsSpeakerTestRunning(true)
    try {
      const succeeded = await window.controllerControls.native.send(
        'audio.verifyDualSenseUSBSpeaker'
      )
      if (succeeded) {
        toast.success('Wired DualSense speaker verified', {
          description: 'The bounded test tone finished and macOS output was restored.'
        })
      } else {
        toast.error('Wired DualSense speaker test failed', {
          description:
            'Reconnect with a data-capable USB cable and confirm the controller audio route.'
        })
      }
      setSystem(await window.controllerControls.system.refresh())
    } finally {
      setIsSpeakerTestRunning(false)
    }
  }, [isSpeakerTestRunning])



  const agentActivities = useMemo<AgentActivity[]>(
    () => [
      {
        kind: 'codex',
        state: system?.codexRunning
          ? isEnabled
            ? 'working'
            : 'paused'
          : 'offline',
        detail: system?.codexRunning
          ? isEnabled
            ? 'Desktop app is available'
            : 'Dispatch paused'
          : 'Desktop app is not running'
      },
      {
        kind: 'actions',
        state: isActionRunning ? 'working' : isEnabled ? 'ready' : 'paused',
        detail: isActionRunning
          ? 'Dispatching mapped action'
          : isEnabled
            ? 'Mappings are ready'
            : 'Actions paused'
      }
    ],
    [isActionRunning, isEnabled, system?.codexRunning]
  )

  const isMicroCompanionProfile = activeProfile?.name === MICRO_PROFILE_NAME
  const microDialMode = useMemo(
    () => (activeProfile ? microDialModeFromProfile(activeProfile) : null),
    [activeProfile]
  )

  const conflicts = useMemo(() => mappingConflicts(activeProfile), [activeProfile])
  const hasUnsavedChanges = autosaveState !== 'saved'

  return {
    section,
    setSection,
    library,
    setLibrary,
    activeProfile,
    controller,
    controllerActiveValuesRef,
    subscribeActiveValues,
    selectedInput,
    selectedBinding,
    selectInput,
    deselectInput,
    selectBinding,
    addBinding,
    deleteSelectedBinding,
    updateSelectedBinding,
    activeLayer,
    // The ref the gesture pipeline reads has to move with the state, so the UI
    // switcher goes through the same helper the shift gestures do.
    setActiveLayer: applyActiveLayer,
    // True while presses are deliberately not being turned into actions: the
    // shortcut recorder is listening, or the bridge is verifying the microphone.
    mappingsSuspended,
    isEnabled,
    setIsEnabled: setControllerEnabled,
    lightStatus,
    agentActivities,
    controllerEvents,
    rotationTrace,
    stickDiagnostics,
    system,
    experimentalDualSenseMicrophoneEnabled,
    setExperimentalDualSenseMicrophoneEnabled,
    codexBindingsConfirmed,
    setCodexBindingConfirmed,
    codexKeymap,
    isApplyingCodexKeymap,
    applyCodexKeymap,
    refreshCodexKeymap,
    codexRestartPrompt,
    dismissCodexRestartPrompt,
    isSpeakerTestRunning,
    verifyUSBControllerSpeaker,
    refreshSystem,
    revertLibrary,
    importLibrary,
    exportLibrary,
    resetToDefaults,
    selectProfile,
    duplicateProfile,
    deleteActiveProfile,
    addMicroCompanionProfile,
    setMicroDialMode,
    microDialMode,
    isMicroCompanionProfile,
    updateActiveProfile,
    testSelectedAction,
    autosaveState,
    autosaveMessage,
    // Non-null while the saved library is unreadable and autosave is held off;
    // `retryProfileLoad` and `resetToDefaults` are the two ways out.
    profileLoadError,
    retryProfileLoad: loadProfiles,
    conflicts,
    hasUnsavedChanges,
    allInputs: controller.connected
      ? controller.capabilities.filter((input) => input !== 'share')
      : pickableControllerInputIds,
    inputDisplayNames
  }
}

export type ControllerAppModel = ReturnType<typeof useControllerApp>
