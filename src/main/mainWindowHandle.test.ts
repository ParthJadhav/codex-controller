import { describe, expect, it, vi } from 'vitest'
import type { NativeBridgeEvent } from '../shared/contracts'
import { MainWindowHandle, type MainWindowTarget } from './mainWindowHandle'

/**
 * Regression: on macOS the app keeps running after its window closes, so bridge
 * events and second-instance launches must not reach a destroyed window.
 */
interface FakeWindow extends MainWindowTarget {
  destroyed: boolean
  webContentsDestroyed: boolean
  isMinimized: () => boolean
  restore: () => void
  show: () => void
  focus: () => void
  webContents: {
    isDestroyed: () => boolean
    send: (channel: string, ...args: unknown[]) => void
  }
}

const fakeWindow = (): FakeWindow => {
  const flags = { destroyed: false, webContentsDestroyed: false }
  return {
    get destroyed() {
      return flags.destroyed
    },
    set destroyed(value: boolean) {
      flags.destroyed = value
    },
    get webContentsDestroyed() {
      return flags.webContentsDestroyed
    },
    set webContentsDestroyed(value: boolean) {
      flags.webContentsDestroyed = value
    },
    isDestroyed: () => flags.destroyed,
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isDestroyed: () => flags.destroyed || flags.webContentsDestroyed,
      send: vi.fn()
    }
  }
}

const controllerEvent: NativeBridgeEvent = {
  type: 'error',
  payload: { message: 'boom' }
}

describe('MainWindowHandle', () => {
  it('forwards bridge events to an attached window', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)

    expect(handle.forwardNativeEvent(controllerEvent)).toBe(true)
    expect(window.webContents.send).toHaveBeenCalledWith('native:event', controllerEvent)
  })

  it('drops bridge events after the window reports closed', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)
    handle.release()

    expect(handle.forwardNativeEvent(controllerEvent)).toBe(false)
    expect(window.webContents.send).not.toHaveBeenCalled()
    expect(handle.live).toBeNull()
  })

  it('drops bridge events when the window was destroyed without a closed event', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)
    window.destroyed = true

    expect(handle.forwardNativeEvent(controllerEvent)).toBe(false)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('drops bridge events when only the webContents is gone', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)
    window.webContentsDestroyed = true

    expect(handle.forwardNativeEvent(controllerEvent)).toBe(false)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('forwards a burst of events without throwing once the window is destroyed', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)
    handle.forwardNativeEvent(controllerEvent)
    window.destroyed = true

    expect(() => {
      for (let index = 0; index < 5; index += 1) handle.forwardNativeEvent(controllerEvent)
    }).not.toThrow()
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('reveals a live window for a second instance, restoring it when minimized', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    window.isMinimized = vi.fn(() => true)
    handle.attach(window)

    expect(handle.reveal()).toBe(true)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('leaves a non-minimized window unrestored', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)

    expect(handle.reveal()).toBe(true)
    expect(window.restore).not.toHaveBeenCalled()
  })

  it('does not touch a closed window for a second instance', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)
    handle.release()

    expect(handle.reveal()).toBe(false)
    expect(window.show).not.toHaveBeenCalled()
    expect(window.isMinimized).not.toHaveBeenCalled()
  })

  it('does not touch a destroyed window for a second instance', () => {
    const handle = new MainWindowHandle()
    const window = fakeWindow()
    handle.attach(window)
    window.destroyed = true

    expect(() => handle.reveal()).not.toThrow()
    expect(handle.reveal()).toBe(false)
    expect(window.show).not.toHaveBeenCalled()
  })

  it('accepts a replacement window after the first one closes', () => {
    const handle = new MainWindowHandle()
    const first = fakeWindow()
    handle.attach(first)
    handle.release()
    const second = fakeWindow()
    handle.attach(second)

    expect(handle.forwardNativeEvent(controllerEvent)).toBe(true)
    expect(second.webContents.send).toHaveBeenCalledOnce()
    expect(first.webContents.send).not.toHaveBeenCalled()
  })

  it('starts with no window', () => {
    const handle = new MainWindowHandle()
    expect(handle.live).toBeNull()
    expect(handle.forwardNativeEvent(controllerEvent)).toBe(false)
    expect(handle.reveal()).toBe(false)
  })
})
