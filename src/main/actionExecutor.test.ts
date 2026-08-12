import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionExecutor } from './actionExecutor'
import type { ActionRequest, ActionSequenceStep, MappedAction } from '../shared/contracts'
import type { NativeBridge, NativeBridgeExit } from './nativeBridge'
import { shell, systemPreferences } from 'electron'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  systemPreferences: { isTrustedAccessibilityClient: vi.fn(() => false) }
}))

/** Stands in for the bridge's lifecycle events without spawning anything. */
class FakeBridge extends EventEmitter {
  readonly request = vi.fn(
    async (_command: string, _payload?: unknown, _timeoutMilliseconds?: number) => ({
      success: true,
      message: 'ok'
    })
  )
  readonly reportError = vi.fn()

  asBridge(): NativeBridge {
    return this as unknown as NativeBridge
  }

  exit(willRestart: boolean): void {
    this.emit('exit', { code: 1, signal: null, willRestart } satisfies NativeBridgeExit)
  }
}

const holdAction = {
  type: 'holdShortcut' as const,
  title: 'Hold to dictate',
  shortcut: { keyCode: 2, keyDisplay: 'D', modifiers: ['control' as const] }
}

const holdRequest = (
  gesture: 'holdBegan' | 'holdEnded',
  overrides: Partial<ActionRequest> = {}
): ActionRequest => ({
  action: holdAction,
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  ...overrides,
  gesture
})

describe('ActionExecutor held shortcuts', () => {
  const request = vi.fn()
  const executor = new ActionExecutor(
    Object.assign(new EventEmitter(), { request }) as unknown as NativeBridge
  )

  beforeEach(() => request.mockReset())

  it('refuses a held shortcut that is not part of a hold gesture', async () => {
    const result = await executor.execute({
      action: {
        type: 'holdShortcut',
        title: 'Hold to dictate',
        shortcut: { keyCode: 2, keyDisplay: 'D', modifiers: ['control', 'option', 'shift'] }
      },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal',
      gesture: 'tap'
    })

    expect(request).not.toHaveBeenCalled()
    expect(result.status).toBe('failure')
  })

  it('passes both halves of a held shortcut to the native dispatcher', async () => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true)
    request.mockResolvedValue({ success: true, message: 'Hold to dictate held.' })
    const hold = {
      type: 'holdShortcut' as const,
      title: 'Hold to dictate',
      shortcut: { keyCode: 2, keyDisplay: 'D', modifiers: ['control' as const] }
    }

    for (const gesture of ['holdBegan', 'holdEnded'] as const) {
      const result = await executor.execute({
        action: hold,
        focusPolicy: 'focusIfNeeded',
        safety: 'normal',
        gesture
      })
      expect(result.status).toBe('success')
    }

    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith(
      'action.execute',
      expect.objectContaining({ gesture: 'holdEnded' }),
      expect.any(Number)
    )
  })

  /**
   * Regression: the switch used to end at `sequence`, so an action type the
   * contract grew without a case here resolved to `undefined` — the renderer
   * then read `.status` off nothing while the press looked like it worked.
   */
  it('answers an action type it has no case for', async () => {
    const result = await executor.execute({
      action: { type: 'runShellCommand' as ActionRequest['action']['type'], title: 'Unknown' },
      focusPolicy: 'frontmostOnly',
      safety: 'normal'
    })

    expect(result).toBeDefined()
    expect(result.status).toBe('failure')
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses a mouse click without Accessibility', async () => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false)
    const result = await executor.execute({
      action: { type: 'primaryClick', title: 'Primary mouse click' },
      focusPolicy: 'neverFocus',
      safety: 'normal'
    })

    expect(request).not.toHaveBeenCalled()
    expect(result.status).toBe('permissionNeeded')
  })
})

/**
 * Regression: the bridge posts the key-down for a hold and the key-up arrives in a
 * separate call. A crash in between leaves the combination pressed system-wide.
 */
describe('ActionExecutor holds across a bridge crash', () => {
  let bridge: FakeBridge
  let executor: ActionExecutor

  beforeEach(() => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true)
    bridge = new FakeBridge()
    executor = new ActionExecutor(bridge.asBridge())
  })

  it('tracks a hold between its two halves', async () => {
    await executor.execute(holdRequest('holdBegan'))
    expect(executor.heldShortcutCount).toBe(1)

    await executor.execute(holdRequest('holdEnded'))
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('always sends the key-up after Accessibility is revoked, but refuses a new key-down', async () => {
    await executor.execute(holdRequest('holdBegan', { bindingId: 'dictation' }))
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false)
    bridge.request.mockClear()

    const released = await executor.execute(
      holdRequest('holdEnded', { bindingId: 'dictation' })
    )
    const refused = await executor.execute({
      ...holdRequest('holdBegan', { bindingId: 'mute' }),
      action: {
        type: 'holdShortcut',
        title: 'Hold to mute',
        shortcut: { keyCode: 46, keyDisplay: 'M', modifiers: ['command'] }
      }
    })

    expect(released.status).toBe('success')
    expect(refused.status).toBe('permissionNeeded')
    expect(bridge.request).toHaveBeenCalledOnce()
    expect(bridge.request).toHaveBeenCalledWith(
      'action.execute',
      expect.objectContaining({ bindingId: 'dictation', gesture: 'holdEnded' }),
      expect.any(Number)
    )
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('bypasses consequential arming for an unconditional key-up', async () => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false)

    const result = await executor.execute(
      holdRequest('holdEnded', {
        bindingId: 'dictation',
        safety: 'consequential',
        confirmationPolicy: 'repeatGesture'
      })
    )

    expect(result.status).toBe('success')
    expect(bridge.request).toHaveBeenCalledWith(
      'action.execute',
      expect.objectContaining({ gesture: 'holdEnded', safety: 'consequential' }),
      expect.any(Number)
    )
  })

  it('does not track a hold the native side rejected', async () => {
    bridge.request.mockResolvedValue({ success: false, message: 'no' })
    await executor.execute(holdRequest('holdBegan'))

    expect(executor.heldShortcutCount).toBe(0)
  })

  it('does not track ordinary shortcuts', async () => {
    await executor.execute({
      action: {
        type: 'keyboardShortcut',
        title: 'Send',
        shortcut: { keyCode: 36, keyDisplay: 'Return', modifiers: [] }
      },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal',
      gesture: 'tap'
    })

    expect(executor.heldShortcutCount).toBe(0)
  })

  it('warns that the hold is released on the coming restart', async () => {
    await executor.execute(holdRequest('holdBegan'))
    bridge.exit(true)

    expect(bridge.reportError).toHaveBeenCalledWith(
      'The native bridge stopped while holding Hold to dictate. The key is released as soon as it restarts.'
    )
    expect(executor.heldShortcutCount).toBe(1)
  })

  it('replays the key-up once the bridge restarts', async () => {
    await executor.execute(holdRequest('holdBegan'))
    bridge.exit(true)
    bridge.request.mockClear()

    bridge.emit('restarted')
    await vi.waitFor(() => expect(bridge.request).toHaveBeenCalledOnce())

    expect(bridge.request).toHaveBeenCalledWith(
      'action.execute',
      expect.objectContaining({ gesture: 'holdEnded', action: holdAction }),
      expect.any(Number)
    )
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('releases an old stranded hold without sweeping a new distinct hold', async () => {
    const newAction = {
      type: 'holdShortcut' as const,
      title: 'Hold to mute',
      shortcut: { keyCode: 46, keyDisplay: 'M', modifiers: ['command' as const] }
    }
    await executor.execute(holdRequest('holdBegan', { bindingId: 'old' }))
    bridge.exit(true)
    bridge.request.mockClear()

    let resolveNewBegin!: (value: { success: boolean; message: string }) => void
    bridge.request.mockImplementation(async (_command, payload) => {
      const request = payload as ActionRequest
      if (request.bindingId === 'new' && request.gesture === 'holdBegan') {
        return await new Promise<{ success: boolean; message: string }>((resolve) => {
          resolveNewBegin = resolve
        })
      }
      return { success: true, message: 'released' }
    })

    const newBeginning = executor.execute(
      holdRequest('holdBegan', { bindingId: 'new', action: newAction })
    )
    await vi.waitFor(() => expect(bridge.request).toHaveBeenCalledOnce())

    bridge.emit('restarted')
    await vi.waitFor(() => expect(bridge.request).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(executor.heldShortcutCount).toBe(1))

    const restartReleases = bridge.request.mock.calls
      .map((call) => call[1] as ActionRequest)
      .filter((request) => request.gesture === 'holdEnded')
    expect(restartReleases).toHaveLength(1)
    expect(restartReleases[0]).toEqual(
      expect.objectContaining({ bindingId: 'old', action: holdAction })
    )

    resolveNewBegin({ success: true, message: 'held' })
    await expect(newBeginning).resolves.toEqual({ status: 'success', message: 'held' })
    expect(executor.heldShortcutCount).toBe(1)

    await executor.execute(
      holdRequest('holdEnded', { bindingId: 'new', action: newAction })
    )
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('leaves a new-only restart-window hold untouched', async () => {
    bridge.exit(true)
    await executor.execute(holdRequest('holdBegan', { bindingId: 'new' }))
    bridge.request.mockClear()

    bridge.emit('restarted')
    await Promise.resolve()

    expect(bridge.request).not.toHaveBeenCalled()
    expect(executor.heldShortcutCount).toBe(1)

    await executor.execute(holdRequest('holdEnded', { bindingId: 'new' }))
    expect(bridge.request).toHaveBeenCalledOnce()
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('releases a stranded same chord before registering its new holder', async () => {
    await executor.execute(holdRequest('holdBegan', { bindingId: 'old' }))
    bridge.exit(true)
    bridge.request.mockClear()

    let resolveStrandedRelease!: (value: { success: boolean; message: string }) => void
    bridge.request.mockImplementation(async (_command, payload) => {
      const request = payload as ActionRequest
      if (request.gesture === 'holdEnded') {
        return await new Promise<{ success: boolean; message: string }>((resolve) => {
          resolveStrandedRelease = resolve
        })
      }
      return { success: true, message: 'new hold registered' }
    })

    const newBeginning = executor.execute(
      holdRequest('holdBegan', { bindingId: 'new' })
    )
    await vi.waitFor(() => expect(bridge.request).toHaveBeenCalledOnce())
    expect(
      (bridge.request.mock.calls[0]?.[1] as ActionRequest).gesture
    ).toBe('holdEnded')

    bridge.emit('restarted')
    await Promise.resolve()
    // Restart replay shares the already-running stranded key-up instead of
    // posting another or clearing the holder that will be registered next.
    expect(bridge.request).toHaveBeenCalledOnce()

    resolveStrandedRelease({ success: true, message: 'old released' })
    await expect(newBeginning).resolves.toEqual({
      status: 'success',
      message: 'new hold registered'
    })
    expect(
      bridge.request.mock.calls.map((call) => (call[1] as ActionRequest).gesture)
    ).toEqual(['holdEnded', 'holdBegan'])
    expect(executor.heldShortcutCount).toBe(1)

    bridge.request.mockResolvedValue({ success: true, message: 'new released' })
    await executor.execute(holdRequest('holdEnded', { bindingId: 'new' }))
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('reports a hold it cannot release when the bridge stays down', async () => {
    await executor.execute(holdRequest('holdBegan'))
    bridge.exit(false)

    expect(bridge.reportError).toHaveBeenCalledWith(
      'The native bridge stopped while holding Hold to dictate and cannot release it. Tap the key once if it stays down.'
    )
    // Keep the cleanup intent: a later manual retry or recovered helper can
    // still confirm the key-up instead of losing the only record of it.
    expect(executor.heldShortcutCount).toBe(1)
  })

  it('reports a replayed key-up the restarted bridge refused', async () => {
    await executor.execute(holdRequest('holdBegan'))
    bridge.request.mockResolvedValue({ success: false, message: 'no controller' })

    await executor.releaseHeldShortcuts()

    expect(bridge.reportError).toHaveBeenCalledWith(
      'Hold to dictate may still be held down: no controller'
    )
    expect(executor.heldShortcutCount).toBe(1)

    bridge.request.mockResolvedValue({ success: true, message: 'released' })
    await executor.releaseHeldShortcuts()
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('stays silent on an exit with nothing held', async () => {
    await executor.execute(holdRequest('holdBegan'))
    await executor.execute(holdRequest('holdEnded'))

    bridge.exit(false)
    bridge.emit('restarted')

    expect(bridge.reportError).not.toHaveBeenCalled()
  })

  it('releases every distinct hold that was in flight', async () => {
    await executor.execute(holdRequest('holdBegan'))
    await executor.execute({
      ...holdRequest('holdBegan'),
      action: {
        type: 'holdShortcut',
        title: 'Hold to mute',
        shortcut: { keyCode: 46, keyDisplay: 'M', modifiers: ['command'] }
      }
    })
    expect(executor.heldShortcutCount).toBe(2)

    bridge.request.mockClear()
    await executor.releaseHeldShortcuts()

    expect(bridge.request).toHaveBeenCalledTimes(2)
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('reference-counts equivalent physical chords until every binding releases', async () => {
    const duplicateModifierAction = {
      ...holdAction,
      title: 'Same physical chord under another title',
      shortcut: {
        ...holdAction.shortcut,
        modifiers: ['control' as const, 'control' as const]
      }
    }

    await executor.execute(holdRequest('holdBegan', { bindingId: 'first' }))
    await executor.execute(
      holdRequest('holdBegan', {
        bindingId: 'second',
        action: duplicateModifierAction
      })
    )

    expect(bridge.request).toHaveBeenCalledOnce()
    expect(executor.heldShortcutCount).toBe(1)

    const firstRelease = await executor.execute(
      holdRequest('holdEnded', { bindingId: 'first' })
    )
    expect(firstRelease).toEqual({
      status: 'success',
      message: 'Hold to dictate remains held.'
    })
    expect(bridge.request).toHaveBeenCalledOnce()
    expect(executor.heldShortcutCount).toBe(1)

    await executor.execute(
      holdRequest('holdEnded', {
        bindingId: 'second',
        action: duplicateModifierAction
      })
    )
    expect(bridge.request).toHaveBeenCalledTimes(2)
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('counts two starts from the same binding before releasing the chord', async () => {
    await executor.execute(holdRequest('holdBegan', { bindingId: 'shared' }))
    await executor.execute(holdRequest('holdBegan', { bindingId: 'shared' }))

    expect(bridge.request).toHaveBeenCalledOnce()
    await executor.execute(holdRequest('holdEnded', { bindingId: 'shared' }))
    expect(bridge.request).toHaveBeenCalledOnce()
    expect(executor.heldShortcutCount).toBe(1)

    await executor.execute(holdRequest('holdEnded', { bindingId: 'shared' }))
    expect(bridge.request).toHaveBeenCalledTimes(2)
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('reserves an in-flight key-down before quit and waits for its key-up', async () => {
    let resolveBegin!: (value: { success: boolean; message: string }) => void
    let resolveRelease!: (value: { success: boolean; message: string }) => void
    bridge.request
      .mockImplementationOnce(
        async () =>
          await new Promise<{ success: boolean; message: string }>((resolve) => {
            resolveBegin = resolve
          })
      )
      .mockImplementationOnce(
        async () =>
          await new Promise<{ success: boolean; message: string }>((resolve) => {
            resolveRelease = resolve
          })
      )

    const beginning = executor.execute(
      holdRequest('holdBegan', { bindingId: 'dictation' })
    )
    expect(executor.heldShortcutCount).toBe(1)

    let shutdownFinished = false
    const shuttingDown = executor.prepareForShutdown(2_000).then(() => {
      shutdownFinished = true
    })
    await vi.waitFor(() => expect(bridge.request).toHaveBeenCalledTimes(2))
    expect(shutdownFinished).toBe(false)
    expect(bridge.request.mock.calls[1]).toEqual([
      'action.execute',
      expect.objectContaining({ gesture: 'holdEnded' }),
      2_000
    ])

    const refused = await executor.execute({
      ...holdRequest('holdBegan', { bindingId: 'mute' }),
      action: {
        type: 'holdShortcut',
        title: 'Hold to mute',
        shortcut: { keyCode: 46, keyDisplay: 'M', modifiers: ['command'] }
      }
    })
    expect(refused.status).toBe('failure')
    expect(bridge.request).toHaveBeenCalledTimes(2)

    resolveRelease({ success: true, message: 'released' })
    await expect(shuttingDown).resolves.toBeUndefined()
    expect(shutdownFinished).toBe(true)
    expect(executor.heldShortcutCount).toBe(0)

    resolveBegin({ success: true, message: 'held' })
    await expect(beginning).resolves.toEqual({ status: 'success', message: 'held' })
    expect(executor.heldShortcutCount).toBe(0)
  })

  it('waits for every release attempt when one bridge request rejects', async () => {
    await executor.execute(holdRequest('holdBegan'))
    await executor.execute({
      ...holdRequest('holdBegan'),
      action: {
        type: 'holdShortcut',
        title: 'Hold to mute',
        shortcut: { keyCode: 46, keyDisplay: 'M', modifiers: ['command'] }
      }
    })
    bridge.request.mockClear()
    let resolveSecond!: (value: { success: boolean; message: string }) => void
    bridge.request
      .mockRejectedValueOnce(new Error('release transport failed'))
      .mockImplementationOnce(
        async () =>
          await new Promise<{ success: boolean; message: string }>((resolve) => {
            resolveSecond = resolve
          })
      )

    let finished = false
    const releasing = executor.releaseHeldShortcuts(2_000).then(() => {
      finished = true
    })
    await vi.waitFor(() => expect(bridge.request).toHaveBeenCalledTimes(2))
    expect(finished).toBe(false)

    resolveSecond({ success: true, message: 'released' })
    await expect(releasing).resolves.toBeUndefined()

    expect(bridge.request).toHaveBeenCalledTimes(2)
    expect(bridge.request.mock.calls.map((call) => call[2])).toEqual([2_000, 2_000])
    expect(bridge.reportError).toHaveBeenCalledWith(
      'Hold to dictate may still be held down: release transport failed'
    )
    expect(executor.heldShortcutCount).toBe(1)
  })
})

const bridgeWithRequest = () => {
  const request = vi.fn(async () => ({ success: true, message: 'dispatched' }))
  const bridge = Object.assign(new EventEmitter(), {
    request,
    reportError: vi.fn()
  }) as unknown as NativeBridge
  return { bridge, request }
}

const requestFor = (action: MappedAction, overrides: Partial<ActionRequest> = {}): ActionRequest => ({
  action,
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  ...overrides
})

/**
 * Regression: a deep link is a string straight out of the profile, and a profile
 * can be hand-edited or imported. `shell.openExternal` hands whatever it is
 * given to Launch Services, so the scheme check is the only thing between an
 * imported profile and `file://` or `javascript:`.
 */
describe('ActionExecutor URL actions', () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockReset()
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true)
  })

  const executor = (): ActionExecutor => new ActionExecutor(bridgeWithRequest().bridge)

  describe('deepLink', () => {
    it('opens a codex:// link', async () => {
      const result = await executor().execute(
        requestFor({ type: 'deepLink', title: 'Open Codex', deepLinkURL: 'codex://open/tasks' })
      )

      expect(result).toEqual({ status: 'success', message: 'Opened Open Codex.' })
      expect(shell.openExternal).toHaveBeenCalledWith('codex://open/tasks')
    })

    it('accepts the scheme in any case', async () => {
      const result = await executor().execute(
        requestFor({ type: 'deepLink', title: 'Open Codex', deepLinkURL: 'CODEX://open' })
      )

      expect(result.status).toBe('success')
    })

    it.each([
      'file:///etc/passwd',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'https://example.com',
      'x-codex://open',
      ' codex://open'
    ])('refuses %s', async (deepLinkURL) => {
      const result = await executor().execute(
        requestFor({ type: 'deepLink', title: 'Open Codex', deepLinkURL })
      )

      expect(result).toEqual({
        status: 'failure',
        message: 'Only codex:// links are accepted for Codex deep-link actions.'
      })
      expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it('refuses a deep-link action with no URL at all', async () => {
      const result = await executor().execute(requestFor({ type: 'deepLink', title: 'Open Codex' }))

      expect(result).toEqual({ status: 'failure', message: 'The action has no URL.' })
      expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it('returns a failure result when Launch Services rejects the deep link', async () => {
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('no handler'))

      await expect(
        executor().execute(
          requestFor({ type: 'deepLink', title: 'Open Codex', deepLinkURL: 'codex://open/tasks' })
        )
      ).resolves.toEqual({
        status: 'failure',
        message: 'Could not open Open Codex: no handler'
      })
    })
  })

  describe('openWebURL', () => {
    it.each(['https://example.com/docs', 'http://localhost:3000/'])(
      'opens %s',
      async (deepLinkURL) => {
        const result = await executor().execute(
          requestFor({ type: 'openWebURL', title: 'Docs', deepLinkURL })
        )

        expect(result.status).toBe('success')
        expect(shell.openExternal).toHaveBeenCalledWith(new URL(deepLinkURL).toString())
      }
    )

    it.each(['file:///etc/passwd', 'javascript:alert(1)', 'codex://open', 'data:text/html,<b>hi'])(
      'refuses the %s scheme',
      async (deepLinkURL) => {
        const result = await executor().execute(
          requestFor({ type: 'openWebURL', title: 'Docs', deepLinkURL })
        )

        expect(result).toEqual({
          status: 'failure',
          message: 'Only HTTP and HTTPS URLs can be opened.'
        })
        expect(shell.openExternal).not.toHaveBeenCalled()
      }
    )

    it('refuses a string that is not a URL', async () => {
      const result = await executor().execute(
        requestFor({ type: 'openWebURL', title: 'Docs', deepLinkURL: 'not a url' })
      )

      expect(result).toEqual({ status: 'failure', message: 'The web URL is invalid.' })
      expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it('refuses a web action with no URL at all', async () => {
      const result = await executor().execute(requestFor({ type: 'openWebURL', title: 'Docs' }))

      expect(result).toEqual({ status: 'failure', message: 'The action has no URL.' })
    })

    it('returns a failure result when Launch Services rejects the web URL', async () => {
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('browser unavailable'))

      await expect(
        executor().execute(
          requestFor({
            type: 'openWebURL',
            title: 'Docs',
            deepLinkURL: 'https://example.com/docs'
          })
        )
      ).resolves.toEqual({
        status: 'failure',
        message: 'Could not open Docs: browser unavailable'
      })
    })
  })

  it('answers a layer shift without touching the bridge', async () => {
    const { bridge, request } = bridgeWithRequest()
    const subject = new ActionExecutor(bridge)

    expect(
      await subject.execute(
        requestFor(
          { type: 'layerShift', title: 'Voice', targetLayer: 'voice' },
          { gesture: 'holdBegan' }
        )
      )
    ).toEqual({ status: 'success', message: 'voice layer active.' })
    expect(await subject.execute(requestFor({ type: 'layerShift', title: 'Shift' }))).toEqual({
      status: 'success',
      message: 'Layer active.'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('warns rather than fails on an unassigned control', async () => {
    expect(await executor().execute(requestFor({ type: 'none', title: 'Unassigned' }))).toEqual({
      status: 'warning',
      message: 'This control is unassigned.'
    })
  })
})

/**
 * Regression: a consequential action is armed by the first deliberate gesture and
 * only runs on a second one within five seconds, unless the profile opted into
 * `deliberateGestureOnly`.
 */
describe('ActionExecutor consequential arming', () => {
  const send: MappedAction = {
    type: 'keyboardShortcut',
    title: 'Send to Codex',
    shortcut: { keyCode: 36, keyDisplay: 'Return', modifiers: [] }
  }

  let request: ReturnType<typeof bridgeWithRequest>['request']
  let executor: ActionExecutor

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true)
    const created = bridgeWithRequest()
    request = created.request
    executor = new ActionExecutor(created.bridge)
  })

  afterEach(() => vi.useRealTimers())

  const consequential = (overrides: Partial<ActionRequest> = {}): ActionRequest =>
    requestFor(send, { safety: 'consequential', gesture: 'longPress', ...overrides })

  it.each(['tap', 'buttonDown', 'holdBegan', 'repeatTick', 'rotateClockwise'] as const)(
    'refuses a consequential action delivered by %s',
    async (gesture) => {
      const result = await executor.execute(consequential({ gesture }))

      expect(result).toEqual({
        status: 'failure',
        message: 'Consequential actions require a long press, double tap, or chord.'
      })
      expect(request).not.toHaveBeenCalled()
    }
  )

  it('refuses a consequential action with no gesture at all', async () => {
    expect((await executor.execute(consequential({ gesture: undefined }))).status).toBe('failure')
  })

  it.each(['longPress', 'doubleTap', 'chord'] as const)(
    'arms on the first %s and runs on the second',
    async (gesture) => {
      const armed = await executor.execute(consequential({ gesture }))

      expect(armed).toEqual({
        status: 'warning',
        message:
          'Armed Send to Codex. Repeat the deliberate gesture within five seconds to confirm.'
      })
      expect(request).not.toHaveBeenCalled()

      const confirmed = await executor.execute(consequential({ gesture }))

      expect(confirmed.status).toBe('success')
      expect(request).toHaveBeenCalledOnce()
    }
  )

  it('disarms after running, so the next gesture arms again', async () => {
    await executor.execute(consequential())
    await executor.execute(consequential())
    request.mockClear()

    const third = await executor.execute(consequential())

    expect(third.status).toBe('warning')
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps the arming alive right up to the five-second mark', async () => {
    await executor.execute(consequential())
    vi.advanceTimersByTime(5_000)

    expect((await executor.execute(consequential())).status).toBe('success')
  })

  it('re-arms instead of running once the window has passed', async () => {
    await executor.execute(consequential())
    vi.advanceTimersByTime(5_001)

    const result = await executor.execute(consequential())

    expect(result.status).toBe('warning')
    expect(request).not.toHaveBeenCalled()
  })

  it('does not let one armed action confirm a different one', async () => {
    const other = requestFor(
      { ...send, title: 'Stop Codex' },
      { safety: 'consequential', gesture: 'longPress' }
    )
    await executor.execute(consequential())

    expect((await executor.execute(other)).status).toBe('warning')
    expect(request).not.toHaveBeenCalled()
    // The replacement arming is the live one now.
    expect((await executor.execute(other)).status).toBe('success')
  })

  it('treats a different focus policy on the same action as a different arming', async () => {
    await executor.execute(consequential())

    const result = await executor.execute(consequential({ focusPolicy: 'neverFocus' }))

    expect(result.status).toBe('warning')
    expect(request).not.toHaveBeenCalled()
  })

  it('runs straight away when the profile trusts the deliberate gesture alone', async () => {
    const result = await executor.execute(
      consequential({ confirmationPolicy: 'deliberateGestureOnly' })
    )

    expect(result.status).toBe('success')
    expect(request).toHaveBeenCalledOnce()
  })

  it('still requires a deliberate gesture under deliberateGestureOnly', async () => {
    const result = await executor.execute(
      consequential({ gesture: 'tap', confirmationPolicy: 'deliberateGestureOnly' })
    )

    expect(result.status).toBe('failure')
    expect(request).not.toHaveBeenCalled()
  })

  it('never arms an action the profile calls normal', async () => {
    const result = await executor.execute(requestFor(send, { gesture: 'longPress' }))

    expect(result.status).toBe('success')
    expect(request).toHaveBeenCalledOnce()
  })

  /**
   * A sequence is only as safe as its most dangerous step: declaring the
   * wrapper `normal` must not smuggle a consequential step past the gate.
   */
  it('inherits consequential safety from a nested sequence step', async () => {
    const step = (safety: 'normal' | 'consequential'): ActionSequenceStep => ({
      id: `step-${safety}`,
      delayMilliseconds: 0,
      action: { type: 'keyboardShortcut', title: safety, shortcut: send.shortcut },
      focusPolicy: 'focusIfNeeded',
      safety
    })
    const sequence: MappedAction = {
      type: 'sequence',
      title: 'Approve and send',
      sequenceSteps: [step('normal'), step('consequential')]
    }

    const result = await executor.execute(requestFor(sequence, { gesture: 'longPress' }))

    expect(result.status).toBe('warning')
    expect(request).not.toHaveBeenCalled()
  })

  it('leaves an all-normal sequence ungated', async () => {
    const sequence: MappedAction = {
      type: 'sequence',
      title: 'Two keystrokes',
      sequenceSteps: [
        {
          id: 'one',
          delayMilliseconds: 0,
          action: { type: 'keyboardShortcut', title: 'One', shortcut: send.shortcut },
          focusPolicy: 'focusIfNeeded',
          safety: 'normal'
        }
      ]
    }

    expect((await executor.execute(requestFor(sequence, { gesture: 'tap' }))).status).toBe('success')
  })
})

/**
 * A sequence can sit waiting on its own delays for minutes. The request timeout
 * has to outlast them, or the bridge is declared dead half way through a
 * sequence that is still running.
 */
describe('ActionExecutor native request timeouts', () => {
  let request: ReturnType<typeof bridgeWithRequest>['request']
  let executor: ActionExecutor

  beforeEach(() => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true)
    const created = bridgeWithRequest()
    request = created.request
    executor = new ActionExecutor(created.bridge)
  })

  const timeoutOfLastRequest = (): number =>
    (request.mock.calls.at(-1) as unknown as [string, unknown, number])[2]

  const sequenceOf = (...delays: number[]): MappedAction => ({
    type: 'sequence',
    title: 'Sequence',
    sequenceSteps: delays.map((delayMilliseconds, index) => ({
      id: `step-${index}`,
      delayMilliseconds,
      action: { type: 'primaryClick', title: `Step ${index}` },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal'
    }))
  })

  it('gives a plain keystroke the flat twelve-second timeout', async () => {
    await executor.execute(
      requestFor({
        type: 'keyboardShortcut',
        title: 'Send',
        shortcut: { keyCode: 36, keyDisplay: 'Return', modifiers: [] }
      })
    )

    expect(timeoutOfLastRequest()).toBe(12_000)
  })

  it('keeps the twelve-second floor for a sequence whose delays are short', async () => {
    await executor.execute(requestFor(sequenceOf(0, 0, 500)))

    expect(timeoutOfLastRequest()).toBe(12_000)
  })

  it('gives a sequence its own delays plus ten seconds of headroom', async () => {
    await executor.execute(requestFor(sequenceOf(20_000, 5_000)))

    // Two native dispatch boundaries add 200 ms apiece.
    expect(timeoutOfLastRequest()).toBe(35_400)
  })

  it('includes delays from nested sequences in the request timeout', async () => {
    const nested = sequenceOf(5_000, 5_000, 5_000)
    await executor.execute(
      requestFor({
        type: 'sequence',
        title: 'Outer',
        sequenceSteps: [
          {
            id: 'outer',
            delayMilliseconds: 1_000,
            action: nested,
            focusPolicy: 'focusIfNeeded',
            safety: 'normal'
          }
        ]
      })
    )

    // The outer sequence step and its three nested steps each carry native
    // dispatch allowance in addition to their explicit delays.
    expect(timeoutOfLastRequest()).toBe(26_800)
  })

  it('includes bounded native hold latency for nested held shortcuts', async () => {
    const holdSteps: ActionSequenceStep[] = Array.from({ length: 32 }, (_, index) => ({
      id: `hold-${index}`,
      delayMilliseconds: 200,
      action: {
        type: 'holdShortcut',
        title: `Hold ${index}`,
        shortcut: { keyCode: index, keyDisplay: String(index), modifiers: [] }
      },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal'
    }))

    await executor.execute(
      requestFor({ type: 'sequence', title: 'Many holds', sequenceSteps: holdSteps })
    )

    // 32 × (200 ms delay + 200 ms dispatch + 60 ms bounded key hold), plus
    // ten seconds of request headroom.
    expect(timeoutOfLastRequest()).toBe(24_720)
  })

  it('rejects an over-budget nested sequence before native dispatch', async () => {
    const inner = sequenceOf(...Array.from({ length: 32 }, () => 5_000))
    const sequence: MappedAction = {
      type: 'sequence',
      title: 'Too long',
      sequenceSteps: [
        {
          id: 'nested',
          delayMilliseconds: 5_000,
          action: inner,
          focusPolicy: 'focusIfNeeded',
          safety: 'normal'
        },
        ...sequenceOf(5_000, 5_000).sequenceSteps!
      ]
    }

    const result = await executor.execute(requestFor(sequence))

    expect(result).toEqual({
      status: 'failure',
      message: 'This sequence is too long to run safely. Shorten it or split it into smaller sequences.'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a huge zero-delay nested tree by actual step cost', async () => {
    const leaf = (): ActionSequenceStep => ({
      id: crypto.randomUUID(),
      delayMilliseconds: 0,
      action: { type: 'primaryClick', title: 'Click' },
      focusPolicy: 'focusIfNeeded',
      safety: 'normal'
    })
    const group = (id: string, action: MappedAction): ActionSequenceStep => ({
      id,
      delayMilliseconds: 0,
      action,
      focusPolicy: 'focusIfNeeded',
      safety: 'normal'
    })
    const branches: ActionSequenceStep[] = Array.from({ length: 32 }, (_, branch) =>
      group(`branch-${branch}`, {
        type: 'sequence',
        title: `Branch ${branch}`,
        sequenceSteps: Array.from({ length: 32 }, leaf)
      })
    )
    const result = await executor.execute(
      requestFor({ type: 'sequence', title: 'Zero-delay explosion', sequenceSteps: branches })
    )

    expect(result.status).toBe('failure')
    expect(request).not.toHaveBeenCalled()
  })

  it('treats a sequence with no steps as the floor', async () => {
    await executor.execute(requestFor({ type: 'sequence', title: 'Empty' }))

    expect(timeoutOfLastRequest()).toBe(12_000)
  })
})
