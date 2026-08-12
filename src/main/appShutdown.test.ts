import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { systemPreferences } from 'electron'
import type { ActionRequest } from '../shared/contracts'
import { ActionExecutor } from './actionExecutor'
import {
  AppShutdownCoordinator,
  ProfileFlushRequester
} from './appShutdown'
import type { NativeBridge } from './nativeBridge'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  systemPreferences: { isTrustedAccessibilityClient: vi.fn(() => true) }
}))

const hold: ActionRequest = {
  action: {
    type: 'holdShortcut',
    title: 'Hold to dictate',
    shortcut: { keyCode: 2, keyDisplay: 'D', modifiers: ['control'] }
  },
  focusPolicy: 'focusIfNeeded',
  safety: 'normal',
  gesture: 'holdBegan'
}

describe('AppShutdownCoordinator', () => {
  it('releases holds, flushes profiles, and drains writes before stopping and quitting', async () => {
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true)
    const order: string[] = []
    const bridge = Object.assign(new EventEmitter(), {
      request: vi.fn(async (_command: string, request: ActionRequest) => {
        order.push(request.gesture ?? 'unknown')
        return { success: true, message: 'ok' }
      }),
      reportError: vi.fn()
    }) as unknown as NativeBridge
    const actions = new ActionExecutor(bridge)
    await actions.execute(hold)
    order.length = 0

    const coordinator = new AppShutdownCoordinator({
      releaseHeldShortcuts: () => actions.prepareForShutdown(2_000),
      flushProfiles: async () => {
        order.push('flush')
      },
      drainProfileWrites: async () => {
        order.push('drain')
      },
      stopBridge: () => order.push('stop'),
      quitApp: () => order.push('quit'),
      reportError: vi.fn()
    })
    const first = { preventDefault: vi.fn() }
    const repeated = { preventDefault: vi.fn() }

    coordinator.handleBeforeQuit(first)
    coordinator.handleBeforeQuit(repeated)
    await vi.waitFor(() =>
      expect(order).toEqual(['holdEnded', 'flush', 'drain', 'stop', 'quit'])
    )

    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(repeated.preventDefault).toHaveBeenCalledOnce()

    const final = { preventDefault: vi.fn() }
    coordinator.handleBeforeQuit(final)
    expect(final.preventDefault).not.toHaveBeenCalled()
    expect(order).toEqual(['holdEnded', 'flush', 'drain', 'stop', 'quit'])
  })

  it('cannot reach stop or quit while flush acknowledgment or the write drain is pending', async () => {
    const order: string[] = []
    let acknowledgeFlush: (() => void) | undefined
    let finishDrain: (() => void) | undefined
    const coordinator = new AppShutdownCoordinator({
      releaseHeldShortcuts: async () => {
        order.push('release')
      },
      flushProfiles: () =>
        new Promise<void>((resolve) => {
          order.push('flush')
          acknowledgeFlush = resolve
        }),
      drainProfileWrites: () =>
        new Promise<void>((resolve) => {
          order.push('drain')
          finishDrain = resolve
        }),
      stopBridge: () => order.push('stop'),
      quitApp: () => order.push('quit'),
      reportError: vi.fn()
    })

    coordinator.handleBeforeQuit({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(order).toEqual(['release', 'flush']))

    acknowledgeFlush?.()
    await vi.waitFor(() => expect(order).toEqual(['release', 'flush', 'drain']))

    finishDrain?.()
    await vi.waitFor(() =>
      expect(order).toEqual(['release', 'flush', 'drain', 'stop', 'quit'])
    )
  })

  it('reports every failed shutdown gate but still stops and quits', async () => {
    const reportError = vi.fn()
    const stopBridge = vi.fn()
    const quitApp = vi.fn()
    const coordinator = new AppShutdownCoordinator({
      releaseHeldShortcuts: async () => {
        throw new Error('bridge unavailable')
      },
      flushProfiles: async () => {
        throw new Error('renderer timed out')
      },
      drainProfileWrites: async () => {
        throw new Error('write barrier failed')
      },
      stopBridge,
      quitApp,
      reportError
    })

    coordinator.handleBeforeQuit({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(quitApp).toHaveBeenCalledOnce())

    expect(reportError).toHaveBeenCalledWith(
      'Held shortcuts could not be released before quitting: bridge unavailable'
    )
    expect(reportError).toHaveBeenCalledWith(
      'Profiles could not be flushed before quitting: renderer timed out'
    )
    expect(reportError).toHaveBeenCalledWith(
      'Profile writes could not be drained before quitting: write barrier failed'
    )
    expect(stopBridge).toHaveBeenCalledOnce()
  })
})

const flushTarget = () => ({
  isDestroyed: vi.fn(() => false),
  send: vi.fn<(channel: string, ...args: unknown[]) => void>()
})

describe('ProfileFlushRequester', () => {
  it('settles only from the correlated result sent by the requested renderer', async () => {
    const requester = new ProfileFlushRequester('profiles:flush-request', 2_000)
    const target = flushTarget()
    const otherTarget = flushTarget()
    const request = requester.request(target)
    const requestId = target.send.mock.calls[0]?.[1]

    expect(requestId).toBe('profile-flush-1')
    expect(requester.acceptResult(otherTarget, { requestId, success: true })).toBe(false)

    let settled = false
    void request.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    expect(requester.acceptResult(target, { requestId, success: true })).toBe(true)
    await expect(request).resolves.toBeUndefined()
  })

  it('propagates an explicit renderer save failure', async () => {
    const requester = new ProfileFlushRequester('profiles:flush-request', 2_000)
    const target = flushTarget()
    const request = requester.request(target)
    const requestId = target.send.mock.calls[0]?.[1]

    expect(
      requester.acceptResult(target, {
        requestId,
        success: false,
        message: 'disk is full'
      })
    ).toBe(true)
    await expect(request).rejects.toThrow('disk is full')
  })

  it('bounds an unresponsive renderer with a timeout and ignores its late result', async () => {
    vi.useFakeTimers()
    const requester = new ProfileFlushRequester('profiles:flush-request', 25)
    const target = flushTarget()
    const request = requester.request(target)
    const requestId = target.send.mock.calls[0]?.[1]
    const rejected = expect(request).rejects.toThrow(
      'did not acknowledge the save within 25 ms'
    )

    await vi.advanceTimersByTimeAsync(25)
    await rejected
    expect(requester.acceptResult(target, { requestId, success: true })).toBe(false)
    vi.useRealTimers()
  })

  it('fails immediately when a once-live renderer is already destroyed', async () => {
    const requester = new ProfileFlushRequester('profiles:flush-request', 2_000)
    const target = flushTarget()
    vi.mocked(target.isDestroyed).mockReturnValue(true)

    await expect(requester.request(target)).rejects.toThrow('renderer is unavailable')
    expect(target.send).not.toHaveBeenCalled()
  })
})
