export interface BeforeQuitEvent {
  preventDefault(): void
}

export interface ProfileFlushTarget {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

interface PendingProfileFlush {
  target: ProfileFlushTarget
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface ProfileFlushResult {
  requestId: string
  success: boolean
  message?: string
}

const profileFlushResult = (value: unknown): ProfileFlushResult | null => {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.requestId !== 'string' || typeof candidate.success !== 'boolean') {
    return null
  }
  if (candidate.message !== undefined && typeof candidate.message !== 'string') return null
  return {
    requestId: candidate.requestId,
    success: candidate.success,
    ...(typeof candidate.message === 'string' ? { message: candidate.message } : {})
  }
}

/**
 * Correlates the main process's quit-time flush request with the one renderer
 * that received it. A bounded request means a crashed or unresponsive renderer
 * can never trap the app in a permanently prevented quit.
 */
export class ProfileFlushRequester {
  private nextRequestId = 0
  private readonly pending = new Map<string, PendingProfileFlush>()

  constructor(
    private readonly requestChannel: string,
    private readonly timeoutMilliseconds = 2_000
  ) {}

  request(target: ProfileFlushTarget): Promise<void> {
    if (target.isDestroyed()) {
      return Promise.reject(new Error('The profile renderer is unavailable.'))
    }

    const requestId = `profile-flush-${++this.nextRequestId}`
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(
          new Error(
            `The profile renderer did not acknowledge the save within ${this.timeoutMilliseconds} ms.`
          )
        )
      }, this.timeoutMilliseconds)
      this.pending.set(requestId, { target, resolve, reject, timeout })

      try {
        target.send(this.requestChannel, requestId)
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(requestId)
        const message = error instanceof Error ? error.message : String(error)
        reject(new Error(`The profile save request could not be sent: ${message}`))
      }
    })
  }

  /**
   * Returns false for malformed, late, or cross-window acknowledgements.
   * Renderer-controlled IPC cannot settle another window's pending request.
   */
  acceptResult(sender: unknown, value: unknown): boolean {
    const result = profileFlushResult(value)
    if (!result) return false
    const pending = this.pending.get(result.requestId)
    if (!pending || pending.target !== sender) return false

    clearTimeout(pending.timeout)
    this.pending.delete(result.requestId)
    if (result.success) {
      pending.resolve()
    } else {
      pending.reject(new Error(result.message || 'The renderer could not save the profiles.'))
    }
    return true
  }
}

export interface AppShutdownOptions {
  releaseHeldShortcuts: () => Promise<void>
  flushProfiles: () => Promise<void>
  drainProfileWrites: () => Promise<void>
  stopBridge: () => void
  quitApp: () => void
  reportError: (message: string) => void
}

/**
 * Gives held system-wide shortcuts one bounded chance to post their key-up
 * before the helper process is torn down.
 *
 * Electron emits `before-quit` again for the final `app.quit()`. The `ready`
 * state deliberately lets that second event through, while repeated requests
 * during release all share the same shutdown attempt.
 */
export class AppShutdownCoordinator {
  private state: 'idle' | 'releasing' | 'ready' = 'idle'

  constructor(private readonly options: AppShutdownOptions) {}

  handleBeforeQuit(event: BeforeQuitEvent): void {
    if (this.state === 'ready') return
    event.preventDefault()
    if (this.state === 'releasing') return
    this.state = 'releasing'
    void this.finish()
  }

  private async finish(): Promise<void> {
    try {
      await this.options.releaseHeldShortcuts()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.reportError(`Held shortcuts could not be released before quitting: ${message}`)
    }

    try {
      await this.options.flushProfiles()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.reportError(`Profiles could not be flushed before quitting: ${message}`)
    }

    try {
      await this.options.drainProfileWrites()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.reportError(`Profile writes could not be drained before quitting: ${message}`)
    }

    try {
      this.options.stopBridge()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.reportError(`The native bridge could not be stopped cleanly: ${message}`)
    } finally {
      this.state = 'ready'
      this.options.quitApp()
    }
  }
}
