import type { NativeBridgeEvent } from '../shared/contracts'

/**
 * The slice of `BrowserWindow` the main process touches after startup. Kept
 * structural so the forwarding rules below can be unit-tested without Electron.
 */
export interface MainWindowTarget {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  webContents: {
    isDestroyed(): boolean
    send(channel: string, ...args: unknown[]): void
  }
}

/**
 * Owns the single main window reference and refuses to touch it once it is gone.
 *
 * On macOS the app outlives its window, so bridge events and second-instance
 * launches keep arriving after a close. Every call goes through `live`, which
 * drops a released or already-destroyed window instead of throwing
 * "Object has been destroyed".
 */
export class MainWindowHandle {
  private current: MainWindowTarget | null = null

  attach(window: MainWindowTarget): void {
    this.current = window
  }

  /** Called from the window's own `closed` event. */
  release(): void {
    this.current = null
  }

  /** The attached window, or null when it is released or destroyed. */
  get live(): MainWindowTarget | null {
    if (!this.current) return null
    if (this.current.isDestroyed()) {
      this.current = null
      return null
    }
    return this.current
  }

  /** Returns false when the event had nowhere to go. */
  forwardNativeEvent(event: NativeBridgeEvent): boolean {
    const window = this.live
    if (!window || window.webContents.isDestroyed()) return false
    window.webContents.send('native:event', event)
    return true
  }

  /** Raises the window for a second-instance launch. False when there is none. */
  reveal(): boolean {
    const window = this.live
    if (!window) return false
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return true
  }
}
