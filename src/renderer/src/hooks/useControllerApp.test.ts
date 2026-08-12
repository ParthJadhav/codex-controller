import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActionRequest,
  ActionResult,
  ControllerBinding,
  ControllerSnapshot,
  MappingProfile,
  NativeBridgeEvent,
  ProfileLibrary,
  SystemSnapshot
} from '@shared/contracts'
import { codexCommands } from '@shared/codexCommands'
import { createDefaultProfile } from '@shared/defaultProfile'
import { diagnosticsAttention } from '../core/attention'
import { controllerInputSuspension } from '../core/inputSuspension'
import { useControllerApp } from './useControllerApp'

const connected: ControllerSnapshot = {
  connected: true,
  id: 'dualsense',
  name: 'DualSense Wireless Controller',
  productCategory: 'DualSense',
  transport: 'USB',
  batteryLevel: 0.8,
  supportsLight: true,
  supportsHaptics: true,
  touchpadPointerEnabled: false,
  touchpadPointerStatus: 'disabled',
  capabilities: [],
  activeValues: {}
}

/** Stick positions on the unit circle, converted to the four axis inputs. */
const stickAt = (
  degrees: number,
  side: 'left' | 'right' = 'left'
): ControllerSnapshot['activeValues'] => {
  const x = Math.cos((degrees * Math.PI) / 180)
  const y = Math.sin((degrees * Math.PI) / 180)
  const prefix = side === 'left' ? 'leftStick' : 'rightStick'
  return {
    [`${prefix}Right`]: Math.max(x, 0),
    [`${prefix}Left`]: Math.max(-x, 0),
    [`${prefix}Up`]: Math.max(y, 0),
    [`${prefix}Down`]: Math.max(-y, 0)
  }
}

describe('controller app dispatch', () => {
  const listeners: Array<(event: NativeBridgeEvent) => void> = []
  let flushProfiles: (() => Promise<void>) | null = null
  const execute = vi.fn(
    async (_request: ActionRequest): Promise<ActionResult> => ({
      status: 'success',
      message: 'ok'
    })
  )
  let library: ProfileLibrary

  const emit = (payload: ControllerSnapshot): void => {
    act(() => {
      for (const listener of listeners) listener({ type: 'controller', payload })
    })
  }

  /**
   * Several snapshots inside one `act`, so React commits nothing between them.
   * That is the shape of a real burst of controller events, and it is what
   * catches a layer that only reaches the gesture pipeline through state.
   */
  const emitTogether = (...payloads: ControllerSnapshot[]): void => {
    act(() => {
      for (const payload of payloads) {
        for (const listener of listeners) listener({ type: 'controller', payload })
      }
    })
  }

  const press = (input: string, pressed: boolean): ControllerSnapshot => ({
    ...connected,
    lastInput: input as ControllerSnapshot['lastInput'],
    lastPressed: pressed,
    activeValues: pressed ? { [input]: 1 } : {}
  })

  const gestures = (): unknown[] => execute.mock.calls.map(([request]) => request.gesture)
  const shortcuts = (): unknown[] =>
    execute.mock.calls.map(([request]) =>
      'shortcut' in request.action ? request.action.shortcut : undefined
    )

  beforeEach(() => {
    listeners.length = 0
    flushProfiles = null
    execute.mockClear()
    // Not just the calls: a test that makes dispatch fail must not leave the
    // executor failing for every test after it.
    execute.mockResolvedValue({ status: 'success', message: 'ok' })
    window.localStorage.clear()
    const profile = createDefaultProfile()
    library = { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
    vi.stubGlobal('navigator', { ...window.navigator, getGamepads: () => [] })
    Object.defineProperty(window, 'controllerControls', {
      configurable: true,
      value: {
        profiles: {
          load: vi.fn(async () => library),
          save: vi.fn(async (value: ProfileLibrary) => value),
          import: vi.fn(),
          export: vi.fn(),
          onFlushRequested: vi.fn((listener: () => Promise<void>) => {
            flushProfiles = listener
            return () => {
              if (flushProfiles === listener) flushProfiles = null
            }
          })
        },
        actions: {
          execute,
          sendMessage: vi.fn(async () => ({ status: 'success', message: 'sent' })),
          showOverlay: vi.fn()
        },
        system: {
          snapshot: vi.fn(async () => null),
          refresh: vi.fn(),
          openSettings: vi.fn(),
          requestMediaAccess: vi.fn(),
          requestSpeechAccess: vi.fn()
        },
        native: {
          send: vi.fn(async () => true),
          subscribe: (listener: (event: NativeBridgeEvent) => void) => {
            listeners.push(listener)
            return () => listeners.splice(listeners.indexOf(listener), 1)
          }
        }
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const mount = async () => {
    const rendered = renderHook(() => useControllerApp())
    await waitFor(() => expect(rendered.result.current.library).toBe(library))
    return rendered
  }

  /**
   * Loading the profile used to select `bindings[0]`, which is the D-pad. That
   * opened the editor on a control the user never clicked and invited an edit to
   * it. The editor has an empty state; nothing should be selected until the user
   * picks something.
   */
  it('selects nothing once the profile has loaded', async () => {
    const rendered = await mount()

    expect(rendered.result.current.selectedInput).toBeNull()
    expect(rendered.result.current.selectedBinding).toBeNull()
  })

  it('still selects a control when the user asks for one', async () => {
    const rendered = await mount()

    act(() => rendered.result.current.selectInput('buttonA'))
    expect(rendered.result.current.selectedInput).toBe('buttonA')
    expect(rendered.result.current.selectedBinding).not.toBeNull()

    act(() => rendered.result.current.deselectInput())
    expect(rendered.result.current.selectedInput).toBeNull()
  })

  /**
   * L3 rotation is retired. The gesture is still recognised by the tracker —
   * that is shared with R3 and must keep working — but nothing is mapped to it,
   * so it must reach the executor as silence rather than as a stray action.
   */
  it('dispatches nothing for a left-stick rotation in either direction', async () => {
    await mount()

    for (const degrees of [90, 45, 0, 45, 90]) {
      emit({ ...connected, activeValues: stickAt(degrees) })
    }

    expect(execute).not.toHaveBeenCalled()
  })

  it('sends the reasoning-effort command when the right stick is rotated', async () => {
    await mount()

    for (const degrees of [90, 45, 0]) {
      emit({ ...connected, activeValues: stickAt(degrees, 'right') })
    }

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          shortcut: codexCommands.increaseReasoningEffort.shortcut
        })
      })
    )
  })

  /**
   * The load rejected, so the file on disk may still hold a recoverable library.
   * Marking the hook loaded and letting the first edit autosave the in-memory
   * defaults is what turned an unreadable file into a destroyed one.
   */
  describe('after the profile library fails to load', () => {
    const save = (): ReturnType<typeof vi.fn> =>
      window.controllerControls.profiles.save as unknown as ReturnType<typeof vi.fn>

    const mountAfterLoadFailure = async () => {
      ;(window.controllerControls.profiles.load as unknown as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('profiles.json could not be read as a profile library.'))
      const rendered = renderHook(() => useControllerApp())
      await waitFor(() => expect(rendered.result.current.profileLoadError).not.toBeNull())
      return rendered
    }

    it('does not autosave an edit over the file it could not read', async () => {
      const rendered = await mountAfterLoadFailure()

      act(() => rendered.result.current.selectInput('buttonA'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Edited', deepLinkURL: 'https://example.com' }
        })
      )
      // Comfortably past the 600 ms autosave debounce.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_200))
      })

      expect(save()).not.toHaveBeenCalled()
      expect(rendered.result.current.autosaveState).toBe('error')
      rendered.unmount()
      expect(save()).not.toHaveBeenCalled()
    })

    it('saves again once the user retries and the load succeeds', async () => {
      const rendered = await mountAfterLoadFailure()
      ;(window.controllerControls.profiles.load as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValue(library)

      await act(async () => {
        await rendered.result.current.retryProfileLoad()
      })
      expect(rendered.result.current.profileLoadError).toBeNull()

      act(() => rendered.result.current.selectInput('buttonA'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Edited', deepLinkURL: 'https://example.com' }
        })
      )
      await waitFor(() => expect(save()).toHaveBeenCalled())
    })

    /** Starting fresh is an explicit decision to discard whatever is on disk. */
    it('saves again once the user chooses to start from the defaults', async () => {
      const rendered = await mountAfterLoadFailure()

      act(() => rendered.result.current.resetToDefaults())
      expect(rendered.result.current.profileLoadError).toBeNull()

      await waitFor(() => expect(save()).toHaveBeenCalled())
    })
  })

  it('posts the D-pad to Codex as a plain arrow key', async () => {
    await mount()
    vi.useFakeTimers()

    emit({
      ...connected,
      lastInput: 'dpadDown',
      lastPressed: true,
      activeValues: { dpadDown: 1 }
    })
    emit({ ...connected, lastInput: 'dpadDown', lastPressed: false, activeValues: {} })
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          type: 'keyboardShortcut',
          shortcut: expect.objectContaining({ keyCode: 0x7d })
        })
      })
    )
  })

  /**
   * A `holdShortcut` posts key-down for `holdBegan` and key-up for `holdEnded`.
   * Testing one gesture on its own therefore left ⌃⇧D physically down for the
   * rest of the session — dictation that never stops.
   */
  describe('testing a hold shortcut', () => {
    const holdBinding = (gesture: 'holdBegan' | 'holdEnded') => {
      const found = library.profiles[0].bindings.find(
        (candidate) => candidate.action.type === 'holdShortcut' && candidate.gesture === gesture
      )
      if (!found) throw new Error(`the default profile has no ${gesture} holdShortcut binding`)
      return found
    }

    it('dispatches a full press-release pair', async () => {
      const rendered = await mount()
      const held = holdBinding('holdBegan')

      act(() => rendered.result.current.selectBinding(held))
      await act(async () => {
        await rendered.result.current.testSelectedAction()
      })

      const gestures = execute.mock.calls.map(([request]) => request.gesture)
      expect(gestures).toEqual(['holdBegan', 'holdEnded'])
      for (const [request] of execute.mock.calls) {
        expect(request.action.type).toBe('holdShortcut')
        expect(request.bindingId).toBe(held.id)
      }
    })

    it('releases the key even when the binding itself is the release half', async () => {
      const rendered = await mount()

      act(() => rendered.result.current.selectBinding(holdBinding('holdEnded')))
      await act(async () => {
        await rendered.result.current.testSelectedAction()
      })

      expect(execute.mock.calls.map(([request]) => request.gesture)).toEqual([
        'holdBegan',
        'holdEnded'
      ])
    })

    it('leaves an ordinary shortcut as a single dispatch', async () => {
      const rendered = await mount()
      const tap = library.profiles[0].bindings.find(
        (candidate) => candidate.action.type === 'keyboardShortcut'
      )!

      act(() => rendered.result.current.selectBinding(tap))
      await act(async () => {
        await rendered.result.current.testSelectedAction()
      })

      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0][0].gesture).toBe(tap.gesture)
    })
  })

  /**
   * Push-to-talk *normally* ends in a blur: the Create binding focuses Codex,
   * which takes focus away from Codex Controller while the button is still down.
   * Dropping the hold there left ⌃⇧D physically down and dictation running for
   * the rest of the session.
   */
  describe('an interruption during a hold', () => {
    const holdShortcut = codexCommands.startDictation.shortcut

    it('releases the held key when the window blurs', async () => {
      await mount()

      emit(press('view', true))
      expect(gestures()).toEqual(['holdBegan'])

      act(() => {
        window.dispatchEvent(new Event('blur'))
      })

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
      expect(shortcuts()).toEqual([holdShortcut, holdShortcut])
    })

    it('releases the held key when the page is hidden', async () => {
      await mount()

      emit(press('view', true))
      act(() => {
        window.dispatchEvent(new Event('pagehide'))
      })

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
    })

    it('releases the held key when the controller reports itself gone', async () => {
      await mount()

      emit(press('view', true))
      emit({ ...connected, connected: false, activeValues: {} })

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
    })

    it('releases the held key when the user pauses the controller', async () => {
      const rendered = await mount()

      emit(press('view', true))
      act(() => rendered.result.current.setIsEnabled(false))

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
      expect(rendered.result.current.isEnabled).toBe(false)
    })

    /** Nothing to release, so nothing may be sent. */
    it('sends nothing when the window blurs with no press in flight', async () => {
      await mount()

      act(() => {
        window.dispatchEvent(new Event('blur'))
      })

      expect(execute).not.toHaveBeenCalled()
    })
  })

  /**
   * A gesture belongs to the layer its press began in. Holding L1 for the voice
   * layer and tapping Cross used to post Return into Codex, because the tap is
   * emitted a double-tap window after the release — by which time L1 was up.
   */
  describe('layer resolution', () => {
    const voiceMute = codexCommands.toggleVoiceMicrophone.shortcut
    const baseReturn = 0x24

    it('resolves a deferred tap against the layer the press began in', async () => {
      await mount()
      vi.useFakeTimers()

      emit(press('leftShoulder', true))
      emit(press('buttonA', true))
      emit(press('buttonA', false))
      // The shift is released well before the double-tap window closes.
      emit(press('leftShoulder', false))
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(shortcuts()).toContainEqual(voiceMute)
      expect(shortcuts()).not.toContainEqual(expect.objectContaining({ keyCode: baseReturn }))
    })

    /**
     * The same press burst with no React commit in between: the layer has to be
     * live in the ref the moment the shift is recognised, not one render later.
     */
    it('applies a layer shift to presses that arrive in the same batch', async () => {
      await mount()
      vi.useFakeTimers()

      emitTogether(
        press('leftShoulder', true),
        press('buttonA', true),
        press('buttonA', false)
      )
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(shortcuts()).toContainEqual(voiceMute)
    })

    it('keeps the layer of a shift that is still held when another is released', async () => {
      const profile = createDefaultProfile()
      profile.bindings.push({
        id: crypto.randomUUID(),
        input: 'rightShoulder',
        gesture: 'holdBegan',
        layer: 'base',
        action: { type: 'layerShift', title: 'Hold Review layer', targetLayer: 'review' },
        focusPolicy: 'focusIfNeeded',
        safety: 'normal',
        isEnabled: true
      })
      library = { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
      const rendered = await mount()

      emit(press('leftShoulder', true))
      expect(rendered.result.current.activeLayer).toBe('voice')

      emit(press('rightShoulder', true))
      expect(rendered.result.current.activeLayer).toBe('review')

      emit(press('rightShoulder', false))
      expect(rendered.result.current.activeLayer).toBe('voice')

      emit(press('leftShoulder', false))
      expect(rendered.result.current.activeLayer).toBe('base')
    })

    it('drops every held layer when input is interrupted', async () => {
      const rendered = await mount()

      emit(press('leftShoulder', true))
      expect(rendered.result.current.activeLayer).toBe('voice')

      act(() => {
        window.dispatchEvent(new Event('blur'))
      })

      expect(rendered.result.current.activeLayer).toBe('base')
    })
  })

  /**
   * `mappingsSuspendedRef` was guarded on in four places and never written, so
   * a controller press during shortcut recording still ran its mapping.
   */
  describe('while mappings are suspended', () => {
    afterEach(() => {
      // A leaked claim would mute the controller for every later test.
      expect(controllerInputSuspension.suspended).toBe(false)
    })

    it('ignores presses while the shortcut recorder is listening, and resumes after', async () => {
      const rendered = await mount()
      vi.useFakeTimers()
      let release = (): void => {}

      act(() => {
        release = controllerInputSuspension.claim()
      })
      expect(rendered.result.current.mappingsSuspended).toBe(true)

      emit(press('dpadDown', true))
      emit(press('dpadDown', false))
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(execute).not.toHaveBeenCalled()

      act(() => release())
      expect(rendered.result.current.mappingsSuspended).toBe(false)

      emit(press('dpadDown', true))
      emit(press('dpadDown', false))
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(execute).toHaveBeenCalledTimes(1)
    })

    /** Suspending is itself an interruption, so a hold in flight is released. */
    it('releases a held key when recording starts mid-hold', async () => {
      await mount()
      let release = (): void => {}

      emit(press('view', true))
      act(() => {
        release = controllerInputSuspension.claim()
      })

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
      act(() => release())
    })

    it('honours the bridge suspending its own input, and resumes with it', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      emit({ ...press('dpadDown', true), inputSuspended: true })
      emit({ ...press('dpadDown', false), inputSuspended: true })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(rendered.result.current.mappingsSuspended).toBe(true)
      expect(execute).not.toHaveBeenCalled()

      emit(press('dpadDown', true))
      emit(press('dpadDown', false))
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(rendered.result.current.mappingsSuspended).toBe(false)
      expect(execute).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * Regression: the merge was `current?.nativeBridgeAvailable ?? snapshot.…`, so
   * whichever value won the startup race stood for the rest of the session. A
   * bridge that came up a moment after the first system snapshot left a
   * permanent "Native bridge is not running" banner on Diagnostics.
   */
  describe('the native bridge availability flag', () => {
    const unavailable: SystemSnapshot = {
      platform: 'darwin',
      appVersion: '1.0.0',
      nativeBridgeAvailable: false,
      codexRunning: false,
      accessibilityTrusted: true,
      microphonePermission: 'granted',
      inputMonitoringTrusted: true,
      audio: {} as SystemSnapshot['audio']
    }

    const permission = (payload: SystemSnapshot): void => {
      act(() => {
        for (const listener of listeners) listener({ type: 'permission', payload })
      })
    }

    const mountWithSystem = async (snapshot: SystemSnapshot) => {
      ;(window.controllerControls.system.snapshot as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValue(snapshot)
      const rendered = renderHook(() => useControllerApp())
      await waitFor(() => expect(rendered.result.current.system).not.toBeNull())
      return rendered
    }

    it('clears the attention banner as soon as the bridge speaks', async () => {
      const rendered = await mountWithSystem(unavailable)
      expect(diagnosticsAttention(rendered.result.current.system).summary).toBe(
        'Native bridge is not running'
      )

      // The event arrived *from* the bridge, so the bridge is running — even
      // when the payload itself does not carry the flag.
      permission({ ...unavailable, nativeBridgeAvailable: undefined })

      expect(rendered.result.current.system?.nativeBridgeAvailable).toBe(true)
      expect(diagnosticsAttention(rendered.result.current.system).summary).toBeNull()
    })

    it('keeps the rest of the permission payload', async () => {
      const rendered = await mountWithSystem(unavailable)

      permission({ ...unavailable, accessibilityTrusted: false })

      expect(rendered.result.current.system?.accessibilityTrusted).toBe(false)
      expect(rendered.result.current.system?.nativeBridgeAvailable).toBe(true)
      expect(diagnosticsAttention(rendered.result.current.system).summary).toBe(
        'Accessibility access required'
      )
    })
  })

  /**
   * Regression: the bridge implements four haptic tones and only `success` was
   * ever asked for. The two that carry what the screen cannot — a layer shift,
   * and a dispatch that failed while the user was looking at Codex — were mute.
   */
  describe('haptic feedback', () => {
    const tones = (): unknown[] =>
      (window.controllerControls.native.send as unknown as ReturnType<typeof vi.fn>).mock.calls
        .filter(([channel]) => channel === 'haptics.play')
        .map(([, payload]) => (payload as { tone: string }).tone)

    it('plays the layer tone on entering a layer', async () => {
      const rendered = await mount()

      emit(press('leftShoulder', true))

      expect(rendered.result.current.activeLayer).toBe('voice')
      expect(tones()).toEqual(['layer'])
    })

    it('says nothing on the way back out of the layer', async () => {
      await mount()

      emit(press('leftShoulder', true))
      emit(press('leftShoulder', false))

      expect(tones()).toEqual(['layer'])
    })

    it('plays the failure tone when a dispatch fails', async () => {
      await mount()
      vi.useFakeTimers()
      execute.mockResolvedValue({ status: 'failure', message: 'nope' })

      emit(press('dpadDown', true))
      emit(press('dpadDown', false))
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(execute).toHaveBeenCalled()
      expect(tones()).toContain('failure')
      expect(tones()).not.toContain('success')
    })

    it('still plays the success tone when a dispatch works', async () => {
      await mount()
      vi.useFakeTimers()

      emit(press('dpadDown', true))
      emit(press('dpadDown', false))
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(tones()).toContain('success')
    })

    it('stays silent for a profile with haptics switched off', async () => {
      const profile = { ...createDefaultProfile(), hapticsEnabled: false }
      library = { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
      await mount()

      emit(press('leftShoulder', true))

      expect(tones()).toEqual([])
    })
  })

  /**
   * Regression: picking a control the profile has no binding for used to append
   * an Unassigned binding to the library, which dirtied it and autosaved a
   * mapping nobody authored — and stamped `base` however the layer switcher was
   * set, so the editor quietly wrote to a layer the user was not looking at.
   */
  describe('selecting a control with no binding yet', () => {
    const save = (): ReturnType<typeof vi.fn> =>
      window.controllerControls.profiles.save as unknown as ReturnType<typeof vi.fn>

    it('does not dirty or save the library on mere selection', async () => {
      const rendered = await mount()
      const before = rendered.result.current.library

      act(() => rendered.result.current.selectInput('home'))
      expect(rendered.result.current.selectedBinding?.action.title).toBe('Unassigned')

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_200))
      })
      expect(save()).not.toHaveBeenCalled()
      expect(rendered.result.current.library).toBe(before)
      expect(rendered.result.current.autosaveState).toBe('saved')
    })

    it('drops the untouched draft again on deselect', async () => {
      const rendered = await mount()

      act(() => rendered.result.current.selectInput('home'))
      act(() => rendered.result.current.deselectInput())

      expect(rendered.result.current.selectedBinding).toBeNull()
      expect(
        rendered.result.current.activeProfile.bindings.some((binding) => binding.input === 'home')
      ).toBe(false)
    })

    it('stamps the layer that is actually active, not base', async () => {
      const rendered = await mount()

      act(() => rendered.result.current.setActiveLayer('review'))
      act(() => rendered.result.current.selectInput('home'))

      expect(rendered.result.current.selectedBinding?.layer).toBe('review')
    })

    it('commits to the library on the first real edit, and saves that', async () => {
      const rendered = await mount()

      act(() => rendered.result.current.setActiveLayer('review'))
      act(() => rendered.result.current.selectInput('home'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Docs', deepLinkURL: 'https://example.com' }
        })
      )

      const committed = rendered.result.current.activeProfile.bindings.find(
        (binding) => binding.input === 'home'
      )
      expect(committed?.layer).toBe('review')
      expect(committed?.action.title).toBe('Docs')
      await waitFor(() => expect(save()).toHaveBeenCalled())
    })
  })

  /**
   * Regression: a long press is announced by a timer. Unmounting has to disarm
   * it — a gesture that fires after teardown resolves against a profile nobody
   * is looking at any more.
   */
  it('dispatches nothing from a press still held when the hook unmounts', async () => {
    const profile = createDefaultProfile()
    // A gesture that only a timer can produce, so the assertion is about the
    // timer rather than about there being nothing bound.
    profile.bindings.push({
      id: crypto.randomUUID(),
      input: 'home',
      gesture: 'longPress',
      layer: 'base',
      action: { type: 'openWebURL', title: 'Late', deepLinkURL: 'https://example.com' },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal',
      isEnabled: true
    })
    library = { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
    const rendered = await mount()
    vi.useFakeTimers()

    emit(press('home', true))
    execute.mockClear()

    rendered.unmount()
    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })

    expect(execute).not.toHaveBeenCalled()
  })

  /** The same press, left mounted, proves the timer was armed to begin with. */
  it('dispatches that long press when the hook is still mounted', async () => {
    const profile = createDefaultProfile()
    profile.bindings.push({
      id: crypto.randomUUID(),
      input: 'home',
      gesture: 'longPress',
      layer: 'base',
      action: { type: 'openWebURL', title: 'Late', deepLinkURL: 'https://example.com' },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal',
      isEnabled: true
    })
    library = { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
    await mount()
    vi.useFakeTimers()

    emit(press('home', true))
    execute.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ gesture: 'longPress' })
    )
  })

  const asMock = (value: unknown): ReturnType<typeof vi.fn> =>
    value as unknown as ReturnType<typeof vi.fn>

  /**
   * Nothing in the app has a Save button, so this state machine is the only
   * account the user gets of whether their edit reached the disk.
   */
  describe('the autosave state machine', () => {
    const save = (): ReturnType<typeof vi.fn> =>
      asMock(window.controllerControls.profiles.save)

    const editSelected = (
      rendered: Awaited<ReturnType<typeof mount>>,
      deepLinkURL = 'https://example.com'
    ): void => {
      act(() => rendered.result.current.selectInput('buttonA'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Edited', deepLinkURL }
        })
      )
    }

    it('rests on saved with nothing edited', async () => {
      const rendered = await mount()

      expect(rendered.result.current.autosaveState).toBe('saved')
      expect(rendered.result.current.autosaveMessage).toBe('All changes saved')
      expect(rendered.result.current.hasUnsavedChanges).toBe(false)
      expect(save()).not.toHaveBeenCalled()
    })

    it('goes saved to pending to saved across the debounce', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      editSelected(rendered)
      expect(rendered.result.current.autosaveState).toBe('pending')
      expect(rendered.result.current.autosaveMessage).toBe('Changes will save automatically')
      expect(rendered.result.current.hasUnsavedChanges).toBe(true)
      expect(save()).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(700)
      })

      expect(save()).toHaveBeenCalledOnce()
      // The save itself is queued behind a promise chain, not behind a timer.
      await act(async () => {
        await Promise.resolve()
      })
      expect(rendered.result.current.autosaveState).toBe('saved')
      expect(rendered.result.current.autosaveMessage).toBe('All changes saved')
    })

    it('collapses a burst of edits inside the debounce into one save', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      editSelected(rendered, 'https://example.com/one')
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      editSelected(rendered, 'https://example.com/two')
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      expect(save()).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(save()).toHaveBeenCalledOnce()
      expect(save().mock.calls[0][0].profiles[0].bindings).toContainEqual(
        expect.objectContaining({
          action: expect.objectContaining({ deepLinkURL: 'https://example.com/two' })
        })
      )
    })

    it('flushes a valid edit when the hook unmounts inside the debounce window', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      editSelected(rendered, 'https://example.com/close-now')
      const latest = structuredClone(rendered.result.current.library)
      expect(save()).not.toHaveBeenCalled()

      rendered.unmount()

      expect(save()).toHaveBeenCalledOnce()
      expect(save()).toHaveBeenCalledWith(latest)
    })

    it('deduplicates beforeunload, pagehide, and React cleanup flushes', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      editSelected(rendered, 'https://example.com/closing')
      act(() => {
        window.dispatchEvent(new Event('beforeunload'))
        window.dispatchEvent(new Event('pagehide'))
      })
      rendered.unmount()

      expect(save()).toHaveBeenCalledOnce()
      expect(save().mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          profiles: expect.arrayContaining([
            expect.objectContaining({
              bindings: expect.arrayContaining([
                expect.objectContaining({
                  action: expect.objectContaining({
                    deepLinkURL: 'https://example.com/closing'
                  })
                })
              ])
            })
          ])
        })
      )
    })

    it('flushes a dirty debounce snapshot and acknowledges only after the save resolves', async () => {
      let finishSave: (() => void) | undefined
      save().mockImplementation(
        (value: ProfileLibrary) =>
          new Promise<ProfileLibrary>((resolve) => {
            finishSave = () => resolve(value)
          })
      )
      const rendered = await mount()
      vi.useFakeTimers()
      editSelected(rendered, 'https://example.com/quit-now')
      expect(save()).not.toHaveBeenCalled()

      let request!: Promise<void>
      act(() => {
        request = flushProfiles!()
      })
      expect(save()).toHaveBeenCalledOnce()
      expect(save().mock.calls[0]?.[0]).toEqual(rendered.result.current.library)

      let acknowledged = false
      void request.then(() => {
        acknowledged = true
      })
      await Promise.resolve()
      expect(acknowledged).toBe(false)

      await act(async () => {
        finishSave?.()
        await request
      })
      expect(acknowledged).toBe(true)
    })

    it('awaits the existing same-snapshot save instead of acknowledging or saving twice', async () => {
      let finishSave: (() => void) | undefined
      save().mockImplementation(
        (value: ProfileLibrary) =>
          new Promise<ProfileLibrary>((resolve) => {
            finishSave = () => resolve(value)
          })
      )
      const rendered = await mount()
      vi.useFakeTimers()
      editSelected(rendered, 'https://example.com/already-saving')
      await act(async () => {
        vi.advanceTimersByTime(700)
        await Promise.resolve()
      })
      expect(save()).toHaveBeenCalledOnce()

      let request!: Promise<void>
      act(() => {
        request = flushProfiles!()
      })
      expect(save()).toHaveBeenCalledOnce()

      let acknowledged = false
      void request.then(() => {
        acknowledged = true
      })
      await Promise.resolve()
      expect(acknowledged).toBe(false)

      await act(async () => {
        finishSave?.()
        await request
      })
      expect(save()).toHaveBeenCalledOnce()
      expect(acknowledged).toBe(true)
    })

    it('freezes later edits while the acknowledged shutdown snapshot is being saved', async () => {
      let finishSave: (() => void) | undefined
      save().mockImplementation(
        (value: ProfileLibrary) =>
          new Promise<ProfileLibrary>((resolve) => {
            finishSave = () => resolve(value)
          })
      )
      const rendered = await mount()
      vi.useFakeTimers()
      editSelected(rendered, 'https://example.com/snapshot-a')
      const snapshotA = structuredClone(rendered.result.current.library)

      let request!: Promise<void>
      act(() => {
        request = flushProfiles!()
      })
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: {
            type: 'openWebURL',
            title: 'Too late',
            deepLinkURL: 'https://example.com/snapshot-b'
          }
        })
      )

      expect(rendered.result.current.library).toEqual(snapshotA)
      expect(save()).toHaveBeenCalledOnce()
      expect(save().mock.calls[0]?.[0]).toEqual(snapshotA)

      await act(async () => {
        finishSave?.()
        await request
      })
      expect(save()).toHaveBeenCalledOnce()
    })

    it('refuses to save an edit the validator rejects, and names the problem', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      editSelected(rendered, 'not-a-url')

      expect(rendered.result.current.autosaveState).toBe('invalid')
      expect(rendered.result.current.autosaveMessage).toBe(
        'Edited needs a complete HTTP or HTTPS URL.'
      )

      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })
      expect(save()).not.toHaveBeenCalled()
    })

    it('leaves invalid for pending as soon as the edit is fixed', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      editSelected(rendered, 'not-a-url')
      expect(rendered.result.current.autosaveState).toBe('invalid')

      editSelected(rendered, 'https://example.com/fixed')
      expect(rendered.result.current.autosaveState).toBe('pending')

      await act(async () => {
        vi.advanceTimersByTime(700)
      })
      expect(save()).toHaveBeenCalledOnce()
    })

    it('holds a library with a mapping conflict out of the file', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      act(() => {
        const profile = rendered.result.current.library.profiles[0]
        rendered.result.current.setLibrary({
          ...rendered.result.current.library,
          profiles: [
            {
              ...profile,
              bindings: [
                ...profile.bindings,
                { ...structuredClone(profile.bindings[0]), id: 'duplicate' }
              ]
            }
          ]
        })
      })

      expect(rendered.result.current.autosaveState).toBe('invalid')
      expect(rendered.result.current.autosaveMessage).toMatch(/^Resolve mapping conflicts in /)
      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })
      expect(save()).not.toHaveBeenCalled()
    })

    it('reports a save the main process refused', async () => {
      const rendered = await mount()
      save().mockRejectedValue(new Error('disk is full'))
      vi.useFakeTimers()

      editSelected(rendered)
      await act(async () => {
        vi.advanceTimersByTime(700)
      })

      await act(async () => {
        await Promise.resolve()
      })
      expect(rendered.result.current.autosaveState).toBe('error')
      expect(rendered.result.current.autosaveMessage).toBe('Autosave failed')
    })

    it('returns to saved once an edit is undone back to what is on disk', async () => {
      const rendered = await mount()
      const original = structuredClone(rendered.result.current.library)
      vi.useFakeTimers()

      editSelected(rendered)
      expect(rendered.result.current.autosaveState).toBe('pending')

      act(() => rendered.result.current.setLibrary(original))

      expect(rendered.result.current.autosaveState).toBe('saved')
      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })
      expect(save()).not.toHaveBeenCalled()
    })
  })

  /**
   * The light is the only feedback the user gets while looking at Codex rather
   * than at Codex Controller, so the result colour has to appear on dispatch and
   * clear itself without a second event to clear it.
   */
  describe('the transient result light', () => {
    const mountWithImmediateBinding = async () => {
      const profile = createDefaultProfile()
      profile.bindings.push({
        id: 'immediate',
        input: 'home',
        gesture: 'buttonDown',
        layer: 'base',
        action: { type: 'openWebURL', title: 'Immediate', deepLinkURL: 'https://example.com' },
        focusPolicy: 'focusIfNeeded',
        safety: 'normal',
        isEnabled: true
      })
      library = { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
      return mount()
    }

    it('shows success for 1.2 seconds and then gives the light back', async () => {
      const rendered = await mountWithImmediateBinding()
      vi.useFakeTimers()

      await act(async () => {
        emit(press('home', true))
      })
      expect(rendered.result.current.lightStatus).toBe('success')

      await act(async () => {
        vi.advanceTimersByTime(1_199)
      })
      expect(rendered.result.current.lightStatus).toBe('success')

      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(rendered.result.current.lightStatus).not.toBe('success')
    })

    it('shows failure when the dispatch failed', async () => {
      execute.mockResolvedValue({ status: 'failure', message: 'no' })
      const rendered = await mountWithImmediateBinding()
      vi.useFakeTimers()

      await act(async () => {
        emit(press('home', true))
      })

      expect(rendered.result.current.lightStatus).toBe('failure')
    })

    it('shows failure when the dispatch needs a permission', async () => {
      execute.mockResolvedValue({ status: 'permissionNeeded', message: 'Accessibility' })
      const rendered = await mountWithImmediateBinding()
      vi.useFakeTimers()

      await act(async () => {
        emit(press('home', true))
      })

      expect(rendered.result.current.lightStatus).toBe('failure')
    })

    /** Re-armed rather than stacked: the second result owns the full window. */
    it('restarts the window on a second dispatch instead of stacking timers', async () => {
      const rendered = await mountWithImmediateBinding()
      vi.useFakeTimers()

      await act(async () => {
        emit(press('home', true))
      })
      await act(async () => {
        vi.advanceTimersByTime(1_000)
      })
      await act(async () => {
        emit(press('home', false))
        emit(press('home', true))
      })

      // 1,000 ms after the first result, but only 200 into the second window.
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(rendered.result.current.lightStatus).toBe('success')

      await act(async () => {
        vi.advanceTimersByTime(1_000)
      })
      expect(rendered.result.current.lightStatus).not.toBe('success')
    })
  })

  /**
   * A chord is only offered to the gesture engine when the profile actually
   * binds that pair — otherwise holding one button while pressing another
   * would swallow the second button's own mapping.
   */
  describe('chords', () => {
    const mountWithChord = async () => {
      const profile = createDefaultProfile()
      profile.bindings.push({
        id: 'the-chord',
        input: 'buttonA',
        secondaryInput: 'buttonB',
        gesture: 'chord',
        layer: 'base',
        action: { type: 'openWebURL', title: 'Chorded', deepLinkURL: 'https://example.com' },
        focusPolicy: 'focusIfNeeded',
        safety: 'normal',
        isEnabled: true
      })
      library = { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
      return mount()
    }

    it('dispatches the bound chord when both controls go down together', async () => {
      await mountWithChord()

      await act(async () => {
        emitTogether(press('buttonA', true), {
          ...connected,
          lastInput: 'buttonB',
          lastPressed: true,
          activeValues: { buttonA: 1, buttonB: 1 }
        })
      })

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          bindingId: 'the-chord',
          gesture: 'chord',
          action: expect.objectContaining({ title: 'Chorded' })
        })
      )
    })

    it('leaves an unbound pair as two ordinary presses', async () => {
      await mount()

      await act(async () => {
        emitTogether(press('buttonA', true), {
          ...connected,
          lastInput: 'buttonB',
          lastPressed: true,
          activeValues: { buttonA: 1, buttonB: 1 }
        })
      })

      expect(gestures()).not.toContain('chord')
    })

    it('selects the chord binding in the editor when it fires', async () => {
      const rendered = await mountWithChord()

      await act(async () => {
        emitTogether(press('buttonA', true), {
          ...connected,
          lastInput: 'buttonB',
          lastPressed: true,
          activeValues: { buttonA: 1, buttonB: 1 }
        })
      })

      expect(rendered.result.current.selectedBinding?.id).toBe('the-chord')
    })
  })

  describe('pausing the controller', () => {
    it('stops turning presses into actions and starts again on resume', async () => {
      const rendered = await mount()
      vi.useFakeTimers()

      act(() => rendered.result.current.setIsEnabled(false))
      expect(rendered.result.current.isEnabled).toBe(false)
      execute.mockClear()

      emit(press('dpadDown', true))
      emit(press('dpadDown', false))
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(execute).not.toHaveBeenCalled()

      act(() => rendered.result.current.setIsEnabled(true))
      emit(press('dpadDown', true))
      emit(press('dpadDown', false))
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      expect(execute).toHaveBeenCalled()
    })

    it('tells the bridge to stop driving the pointer while paused', async () => {
      const rendered = await mount()
      act(() =>
        rendered.result.current.updateActiveProfile({ touchpadPointerEnabled: true })
      )
      const send = asMock(window.controllerControls.native.send)

      await waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          'controller.configure',
          expect.objectContaining({ touchpadPointerEnabled: true })
        )
      )

      act(() => rendered.result.current.setIsEnabled(false))

      await waitFor(() =>
        expect(send).toHaveBeenLastCalledWith(
          'controller.configure',
          expect.objectContaining({ touchpadPointerEnabled: false })
        )
      )
    })
  })

  describe('reverting drafts', () => {
    it('puts the library back to the last saved copy', async () => {
      const rendered = await mount()
      const original = structuredClone(rendered.result.current.library)
      vi.useFakeTimers()

      act(() => rendered.result.current.selectInput('buttonA'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Edited', deepLinkURL: 'https://example.com' }
        })
      )
      expect(rendered.result.current.autosaveState).toBe('pending')

      act(() => rendered.result.current.revertLibrary())

      expect(rendered.result.current.library).toEqual(original)
      expect(rendered.result.current.autosaveState).toBe('saved')
      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })
      expect(asMock(window.controllerControls.profiles.save)).not.toHaveBeenCalled()
    })

    it('parks the selection on the first binding of the restored profile', async () => {
      const rendered = await mount()

      act(() => rendered.result.current.selectInput('buttonA'))
      act(() => rendered.result.current.revertLibrary())

      const first = rendered.result.current.library.profiles[0].bindings[0]
      expect(rendered.result.current.selectedBinding?.id).toBe(first.id)
      expect(rendered.result.current.selectedInput).toBe(first.input)
    })
  })

  describe('importing a profile', () => {
    const importedLibrary = (): ProfileLibrary => {
      const profile = createDefaultProfile()
      profile.name = 'Imported'
      profile.bindings = [
        {
          id: 'imported-binding',
          input: 'buttonY',
          gesture: 'tap',
          layer: 'base',
          action: { type: 'openWebURL', title: 'Imported action', deepLinkURL: 'https://a.test/' },
          focusPolicy: 'focusIfNeeded',
          safety: 'normal',
          isEnabled: true
        }
      ]
      return {
        schemaVersion: 1,
        activeProfileId: profile.id,
        profiles: [...library.profiles, profile]
      }
    }

    it('keeps the existing library and selects the imported profile', async () => {
      const rendered = await mount()
      const current = rendered.result.current.library
      const incoming = importedLibrary()
      asMock(window.controllerControls.profiles.import).mockResolvedValue(incoming)

      await act(async () => {
        await rendered.result.current.importLibrary()
      })

      expect(rendered.result.current.library).toEqual(incoming)
      expect(rendered.result.current.library.profiles[0]).toEqual(current.profiles[0])
      expect(window.controllerControls.profiles.import).toHaveBeenCalledWith(current)
      expect(rendered.result.current.activeProfile.name).toBe('Imported')
      expect(rendered.result.current.selectedBinding?.id).toBe('imported-binding')
      expect(rendered.result.current.selectedInput).toBe('buttonY')
    })

    it('treats the imported file as already saved rather than as a pending edit', async () => {
      const rendered = await mount()
      asMock(window.controllerControls.profiles.import).mockResolvedValue(importedLibrary())
      vi.useFakeTimers()

      await act(async () => {
        await rendered.result.current.importLibrary()
      })

      expect(rendered.result.current.autosaveState).toBe('saved')
      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })
      expect(asMock(window.controllerControls.profiles.save)).not.toHaveBeenCalled()
    })

    it('changes nothing when the user cancels the file picker', async () => {
      const rendered = await mount()
      const before = structuredClone(rendered.result.current.library)
      asMock(window.controllerControls.profiles.import).mockResolvedValue(null)

      await act(async () => {
        await rendered.result.current.importLibrary()
      })

      expect(rendered.result.current.library).toEqual(before)
      expect(rendered.result.current.selectedBinding).toBeNull()
    })

    it('survives a file the main process could not read', async () => {
      const rendered = await mount()
      const before = structuredClone(rendered.result.current.library)
      asMock(window.controllerControls.profiles.import).mockRejectedValue(
        new Error('not a profile library')
      )

      await act(async () => {
        await rendered.result.current.importLibrary()
      })

      expect(rendered.result.current.library).toEqual(before)
    })

    /** Choosing a file is an explicit decision, so it re-arms autosave. */
    it('re-arms autosave after a failed load', async () => {
      asMock(window.controllerControls.profiles.load).mockRejectedValue(new Error('unreadable'))
      const rendered = renderHook(() => useControllerApp())
      await waitFor(() => expect(rendered.result.current.profileLoadError).not.toBeNull())
      asMock(window.controllerControls.profiles.import).mockResolvedValue(importedLibrary())

      await act(async () => {
        await rendered.result.current.importLibrary()
      })
      expect(rendered.result.current.profileLoadError).toBeNull()

      act(() => rendered.result.current.selectInput('buttonY'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Edited', deepLinkURL: 'https://b.test/' }
        })
      )

      await waitFor(() =>
        expect(asMock(window.controllerControls.profiles.save)).toHaveBeenCalled()
      )
    })
  })

  describe('exporting a profile', () => {
    it('passes only the active profile to the main process', async () => {
      const rendered = await mount()
      asMock(window.controllerControls.profiles.export).mockResolvedValue(true)

      await act(async () => {
        await rendered.result.current.exportLibrary()
      })

      expect(window.controllerControls.profiles.export).toHaveBeenCalledWith(
        rendered.result.current.activeProfile
      )
      const exported = asMock(window.controllerControls.profiles.export).mock.calls[0]![0]
      expect(exported).not.toHaveProperty('profiles')
    })
  })

  describe('editor-authored held shortcuts', () => {
    const removeReleaseHalf = (): ControllerBinding => {
      const profile = library.profiles[0]!
      const began = profile.bindings.find(
        (binding) => binding.action.type === 'holdShortcut' && binding.gesture === 'holdBegan'
      )!
      profile.bindings = profile.bindings.filter(
        (binding) =>
          binding.action.type !== 'holdShortcut' || binding.gesture !== 'holdEnded'
      )
      return began
    }

    it('dispatches key-up even when no release binding exists', async () => {
      removeReleaseHalf()
      await mount()

      emit(press('view', true))
      emit(press('view', false))

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
    })

    it.each(['blur', 'pagehide'] as const)(
      'releases an orphaned hold when the window receives %s',
      async (eventName) => {
        removeReleaseHalf()
        await mount()

        emit(press('view', true))
        act(() => window.dispatchEvent(new Event(eventName)))

        expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
      }
    )

    it('releases an orphaned hold when the controller disconnects', async () => {
      removeReleaseHalf()
      await mount()

      emit(press('view', true))
      emit({ ...connected, connected: false })

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
    })

    it('uses the initiating binding after the profile changes mid-hold', async () => {
      const began = removeReleaseHalf()
      const rendered = await mount()
      emit(press('view', true))

      act(() =>
        rendered.result.current.setLibrary((current) => ({
          ...current,
          profiles: current.profiles.map((profile) => ({
            ...profile,
            bindings: profile.bindings.filter((binding) => binding.id !== began.id)
          }))
        }))
      )
      emit(press('view', false))

      expect(gestures()).toEqual(['holdBegan', 'holdEnded'])
      expect(execute.mock.calls[1]?.[0].bindingId).toBe(began.id)
    })
  })

  describe('layer-aware chord recognition', () => {
    const chord = (
      layer: ControllerBinding['layer'],
      isEnabled = true
    ): ControllerBinding => ({
      id: `chord-${layer}`,
      input: 'buttonA',
      secondaryInput: 'buttonB',
      gesture: 'chord',
      layer,
      action: { type: 'primaryClick', title: `${layer} chord` },
      focusPolicy: 'neverFocus',
      safety: 'normal',
      isEnabled
    })

    const pressPair = async (): Promise<void> => {
      emitTogether(
        press('buttonA', true),
        press('buttonB', true),
        press('buttonA', false),
        press('buttonB', false)
      )
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
    }

    it.each([
      ['disabled', chord('base', false)],
      ['off-layer', chord('voice')]
    ])('preserves both taps for a %s chord', async (_label, binding) => {
      library.profiles[0]!.bindings.push(binding)
      await mount()
      vi.useFakeTimers()

      await pressPair()

      const bindingIds = execute.mock.calls.map(([request]) => request.bindingId)
      const profile = library.profiles[0]!
      expect(bindingIds).toContain(
        profile.bindings.find(
          (candidate) => candidate.input === 'buttonA' && candidate.gesture === 'tap'
        )!.id
      )
      expect(bindingIds).toContain(
        profile.bindings.find(
          (candidate) => candidate.input === 'buttonB' && candidate.gesture === 'tap'
        )!.id
      )
      expect(bindingIds).not.toContain(binding.id)
    })

    it('recognizes an enabled Base chord through non-Base fallback', async () => {
      const baseChord = chord('base')
      library.profiles[0]!.bindings.push(baseChord)
      const rendered = await mount()
      vi.useFakeTimers()
      act(() => rendered.result.current.setActiveLayer('voice'))

      await pressPair()

      expect(execute.mock.calls.map(([request]) => request.bindingId)).toContain(baseChord.id)
    })
  })

  describe('autosave ordering', () => {
    it('persists the reverted snapshot after an older save finishes', async () => {
      const original = structuredClone(library)
      let finishFirstSave: (() => void) | undefined
      let disk = structuredClone(original)
      const save = asMock(window.controllerControls.profiles.save)
      save
        .mockImplementationOnce(
          (value: ProfileLibrary) =>
            new Promise<ProfileLibrary>((resolve) => {
              finishFirstSave = () => {
                disk = structuredClone(value)
                resolve(value)
              }
            })
        )
        .mockImplementation(async (value: ProfileLibrary) => {
          disk = structuredClone(value)
          return value
        })

      const rendered = await mount()
      vi.useFakeTimers()
      act(() => rendered.result.current.selectInput('buttonA'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Discard me', deepLinkURL: 'https://a.test/' }
        })
      )
      await act(async () => {
        vi.advanceTimersByTime(700)
        await Promise.resolve()
      })
      expect(save).toHaveBeenCalledTimes(1)

      act(() => rendered.result.current.revertLibrary())
      expect(rendered.result.current.library).toEqual(original)
      expect(rendered.result.current.autosaveState).toBe('saving')

      await act(async () => {
        finishFirstSave?.()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(save).toHaveBeenCalledTimes(2)
      expect(save.mock.calls[1]?.[0]).toEqual(original)
      expect(disk).toEqual(original)
      expect(rendered.result.current.library).toEqual(original)
      expect(rendered.result.current.autosaveState).toBe('saved')
    })

    it('posts a reverted snapshot on unmount behind an older in-flight save', async () => {
      const original = structuredClone(library)
      let finishFirstSave: (() => void) | undefined
      let disk = structuredClone(original)
      let markFirstCommitted: (() => void) | undefined
      const firstCommitted = new Promise<void>((resolve) => {
        markFirstCommitted = resolve
      })
      const save = asMock(window.controllerControls.profiles.save)
      save
        .mockImplementationOnce(
          (value: ProfileLibrary) =>
            new Promise<ProfileLibrary>((resolve) => {
              finishFirstSave = () => {
                disk = structuredClone(value)
                markFirstCommitted?.()
                resolve(value)
              }
            })
        )
        .mockImplementation(async (value: ProfileLibrary) => {
          // Main-process repository saves are ordered even though both IPC
          // requests are registered synchronously by the renderer.
          await firstCommitted
          disk = structuredClone(value)
          return value
        })

      const rendered = await mount()
      vi.useFakeTimers()
      act(() => rendered.result.current.selectInput('buttonA'))
      act(() =>
        rendered.result.current.updateSelectedBinding({
          action: { type: 'openWebURL', title: 'Discard me', deepLinkURL: 'https://a.test/' }
        })
      )
      await act(async () => {
        vi.advanceTimersByTime(700)
        await Promise.resolve()
      })
      expect(save).toHaveBeenCalledOnce()

      act(() => rendered.result.current.revertLibrary())
      rendered.unmount()

      // The exit request is sent synchronously after the stale request. The
      // main repository serializes writes in invocation order, so it remains
      // the final durable snapshot even after this renderer disappears.
      expect(save).toHaveBeenCalledTimes(2)
      expect(save.mock.calls[1]?.[0]).toEqual(original)

      await act(async () => {
        finishFirstSave?.()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(save.mock.calls.at(-1)?.[0]).toEqual(original)
      expect(disk).toEqual(original)
    })
  })

  describe('concurrent dispatch state', () => {
    it('remains working until the last action settles', async () => {
      const completions: Array<(result: ActionResult) => void> = []
      execute.mockImplementation(
        () =>
          new Promise<ActionResult>((resolve) => {
            completions.push(resolve)
          })
      )
      const rendered = await mount()
      vi.useFakeTimers()

      emit(press('buttonA', true))
      emit(press('buttonA', false))
      await act(async () => vi.advanceTimersByTime(400))
      emit(press('buttonB', true))
      emit(press('buttonB', false))
      await act(async () => vi.advanceTimersByTime(400))

      const actionState = (): string | undefined =>
        rendered.result.current.agentActivities.find((activity) => activity.kind === 'actions')
          ?.state
      expect(completions).toHaveLength(2)
      expect(actionState()).toBe('working')

      await act(async () => completions[0]?.({ status: 'success', message: 'first' }))
      expect(actionState()).toBe('working')

      await act(async () => completions[1]?.({ status: 'success', message: 'second' }))
      expect(actionState()).toBe('ready')
    })
  })

  describe('empty profile mapping creation', () => {
    const emptyProfile = (name = 'Empty'): MappingProfile => ({
      ...createDefaultProfile(),
      id: crypto.randomUUID(),
      name,
      bindings: []
    })

    it('chooses the first authorable control when an empty profile has no selection', async () => {
      const empty = emptyProfile()
      library = { schemaVersion: 1, activeProfileId: empty.id, profiles: [empty] }
      const rendered = await mount()

      act(() => rendered.result.current.addBinding())

      expect(rendered.result.current.selectedInput).toBe('buttonA')
      expect(rendered.result.current.activeProfile.bindings).toHaveLength(1)
      expect(rendered.result.current.activeProfile.bindings[0]?.input).toBe('buttonA')
    })

    it('clears the previous profile selection before adding to an empty profile', async () => {
      const populated = library.profiles[0]!
      const empty = emptyProfile('Second')
      library = {
        schemaVersion: 1,
        activeProfileId: populated.id,
        profiles: [populated, empty]
      }
      const rendered = await mount()
      act(() => rendered.result.current.selectInput('buttonY'))

      act(() => rendered.result.current.selectProfile(empty.id))
      expect(rendered.result.current.selectedInput).toBeNull()
      act(() => rendered.result.current.addBinding())

      expect(rendered.result.current.selectedInput).toBe('buttonA')
      expect(rendered.result.current.activeProfile.bindings[0]?.input).toBe('buttonA')
    })

    it('does not copy the legacy Share alias when adding beside an old mapping', async () => {
      const legacyShare: ControllerBinding = {
        id: 'legacy-share',
        input: 'share',
        gesture: 'tap',
        layer: 'base',
        action: { type: 'none', title: 'Legacy Share' },
        focusPolicy: 'neverFocus',
        safety: 'normal',
        isEnabled: true
      }
      const legacy = emptyProfile('Legacy')
      legacy.bindings = [legacyShare]
      library = { schemaVersion: 1, activeProfileId: legacy.id, profiles: [legacy] }
      const rendered = await mount()
      act(() => rendered.result.current.selectBinding(legacyShare))

      act(() => rendered.result.current.addBinding())

      expect(rendered.result.current.activeProfile.bindings).toHaveLength(2)
      expect(rendered.result.current.activeProfile.bindings[1]?.input).toBe('buttonA')
    })
  })

  describe('controller snapshot presentation', () => {
    it('publishes changing touchpad diagnostics under stable controller metadata', async () => {
      const rendered = await mount()
      const diagnosticSnapshot = (contacts: number): ControllerSnapshot => ({
        ...connected,
        touchpadPointerEnabled: true,
        touchpadPointerStatus: 'ready',
        touchpadPointerDiagnostics: {
          source: 'dualsenseHID',
          reports: contacts + 1,
          decodedReports: contacts + 1,
          contacts,
          movements: contacts
        }
      })

      emit(diagnosticSnapshot(0))
      await waitFor(() =>
        expect(rendered.result.current.controller.touchpadPointerDiagnostics?.contacts).toBe(0)
      )
      emit(diagnosticSnapshot(2))

      await waitFor(() =>
        expect(rendered.result.current.controller.touchpadPointerDiagnostics?.contacts).toBe(2)
      )
    })

    it('never offers the legacy Share alias while disconnected', async () => {
      const rendered = await mount()
      expect(rendered.result.current.controller.connected).toBe(false)
      expect(rendered.result.current.allInputs).not.toContain('share')
    })

    it('filters the legacy Share alias out of a connected capability payload', async () => {
      const rendered = await mount()
      emit({ ...connected, capabilities: ['buttonA', 'share'] })

      await waitFor(() => expect(rendered.result.current.controller.connected).toBe(true))
      expect(rendered.result.current.allInputs).toEqual(['buttonA'])
    })
  })
})
