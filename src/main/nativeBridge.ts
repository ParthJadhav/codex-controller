import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import type { NativeBridgeEvent, SystemSnapshot } from '../shared/contracts'

interface NativeCommand {
  id: string
  command: string
  payload?: unknown
}

interface NativeResponse {
  type: 'response'
  id: string
  success: boolean
  message: string
}

/** Payload of the `exit` event. `willRestart` is false once the budget is spent. */
export interface NativeBridgeExit {
  code: number | null
  signal: NodeJS.Signals | null
  willRestart: boolean
}

export interface NativeBridgeOptions {
  /** Resolves the bridge binary, or null when no build is present. */
  resolveBinaryPath?: () => Promise<string | null>
  spawnBridge?: (binary: string) => ChildProcessWithoutNullStreams
  /** One delay per respawn attempt; `[]` disables restarting entirely. */
  restartDelaysMilliseconds?: readonly number[]
}

type LaunchOutcome =
  | { status: 'started' }
  | { status: 'missing'; message: string }
  | { status: 'failed'; message: string }

const defaultRestartDelays = [500, 2_000, 5_000] as const

/**
 * How much of an unterminated line either stream may hold.
 *
 * A child that writes without ever sending a newline — a Swift framework
 * dumping a stack trace, or a wedged writer — used to pin all of it in the main
 * process indefinitely. Past the cap the partial line is dropped and the next
 * newline resynchronises the stream; 64 KiB is far above any line the bridge
 * legitimately emits.
 */
const LINE_BUFFER_LIMIT = 64 * 1024

/**
 * Splits a stream of chunks into whole lines, bounded.
 *
 * `dropped` is true for the chunk that overran the cap, once per overrun, so a
 * caller can say something happened without repeating it for every chunk of a
 * megabyte-long line. Everything up to the next newline is discarded: half a
 * line is not parseable, and reporting it as data would be worse than losing it.
 */
class LineBuffer {
  private text = ''
  private discarding = false

  take(chunk: string): { lines: string[]; dropped: boolean } {
    this.text += chunk
    const lines: string[] = []
    let newline = this.text.indexOf('\n')
    while (newline >= 0) {
      const line = this.text.slice(0, newline).trim()
      this.text = this.text.slice(newline + 1)
      if (this.discarding) this.discarding = false
      else if (line) lines.push(line)
      newline = this.text.indexOf('\n')
    }
    let dropped = false
    if (this.text.length > LINE_BUFFER_LIMIT) {
      dropped = !this.discarding
      this.text = ''
      this.discarding = true
    }
    return { lines, dropped }
  }

  reset(): void {
    this.text = ''
    this.discarding = false
  }
}

const defaultResolveBinaryPath = async (): Promise<string | null> => {
  const binary = app.isPackaged
    ? join(process.resourcesPath, 'native', 'ControllerBridge')
    : join(app.getAppPath(), 'native', '.build', 'debug', 'ControllerBridge')
  try {
    await access(binary)
    return binary
  } catch {
    return null
  }
}

const describeExit = (code: number | null, signal: NodeJS.Signals | null): string =>
  signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Owns the Swift helper process.
 *
 * Every failure mode reaches the renderer as an `error` bridge event rather than
 * as an uncaught exception in the main process: spawn errors (EACCES/ENOEXEC),
 * stdin errors (EPIPE against a dead child), malformed output, and unexpected
 * exits. An unexpected exit also triggers a bounded backoff respawn; each
 * successful respawn asks the new child for a fresh snapshot so the renderer's
 * controller and permission state stop being stale.
 *
 * The child's stderr is diagnostics rather than trouble the user can act on, so
 * it is line-buffered and logged, not raised as an `error` bridge event.
 *
 * Emits: `event` (NativeBridgeEvent), `exit` (NativeBridgeExit), `restarted`.
 * Never emits `error` — EventEmitter would throw that at an unlistening caller.
 */
export class NativeBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly stdoutLines = new LineBuffer()
  private readonly stderrLines = new LineBuffer()
  private available = false
  private pending = new Map<
    string,
    {
      resolve: (value: { success: boolean; message: string }) => void
      timer: NodeJS.Timeout
    }
  >()
  private latestPermissions: Partial<SystemSnapshot> = {}
  private stopping = false
  private restartAttempt = 0
  private restartTimer: NodeJS.Timeout | null = null
  private restartAwaitingReadiness = false
  private readonly resolveBinaryPath: () => Promise<string | null>
  private readonly spawnBridge: (binary: string) => ChildProcessWithoutNullStreams
  private readonly restartDelays: readonly number[]

  constructor(options: NativeBridgeOptions = {}) {
    super()
    this.resolveBinaryPath = options.resolveBinaryPath ?? defaultResolveBinaryPath
    this.spawnBridge =
      options.spawnBridge ?? ((binary) => spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] }))
    this.restartDelays = options.restartDelaysMilliseconds ?? defaultRestartDelays
  }

  get isAvailable(): boolean {
    return this.available
  }

  get systemSnapshot(): Partial<SystemSnapshot> {
    return this.latestPermissions
  }

  /** Surfaces a main-process failure on the renderer's error channel. */
  reportError(message: string): void {
    this.emit('event', {
      type: 'error',
      payload: { message }
    } satisfies NativeBridgeEvent)
  }

  /**
   * Bridge diagnostics, not user-facing trouble.
   *
   * The Swift helper's stderr is mostly framework chatter — CoreAudio and
   * IOHIDManager warnings the user can do nothing about — and routing it to the
   * `error` channel turned every one of them into an app-level error message.
   * It goes to the main process log, where a developer looks for it, and onto a
   * `log` event the renderer ignores.
   */
  private reportLog(message: string): void {
    if (!message) return
    console.warn(`[native bridge] ${message}`)
    this.emit('event', {
      type: 'log',
      payload: { message }
    } satisfies NativeBridgeEvent)
  }

  async start(): Promise<void> {
    this.stopping = false
    this.restartAttempt = 0
    this.restartAwaitingReadiness = false
    const outcome = await this.launch(false)
    // A missing binary is the normal state of a checkout without a Swift build;
    // the renderer already reports it through `nativeBridgeAvailable`.
    if (outcome.status === 'failed') this.reportError(outcome.message)
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.child?.kill()
    this.child = null
    this.available = false
    this.restartAwaitingReadiness = false
  }

  send(command: string, payload?: unknown): boolean {
    const child = this.child
    if (!child || !this.available) return false
    const value: NativeCommand = {
      id: crypto.randomUUID(),
      command,
      payload
    }
    return this.write(child, value)
  }

  request(
    command: string,
    payload?: unknown,
    timeoutMilliseconds = 12_000
  ): Promise<{ success: boolean; message: string }> {
    const child = this.child
    if (!child || !this.available) {
      return Promise.resolve({
        success: false,
        message: 'The native action bridge is unavailable.'
      })
    }
    const id = crypto.randomUUID()
    const value: NativeCommand = { id, command, payload }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ success: false, message: 'The native action timed out.' })
      }, timeoutMilliseconds)
      this.pending.set(id, { resolve, timer })
      if (!this.write(child, value)) {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve({ success: false, message: 'The native action bridge is unavailable.' })
      }
    })
  }

  /**
   * Writing to a child that died between our availability check and this call
   * either throws (destroyed stream) or raises EPIPE on the stdin error handler.
   */
  private write(child: ChildProcessWithoutNullStreams, value: NativeCommand): boolean {
    try {
      child.stdin.write(`${JSON.stringify(value)}\n`)
      return true
    } catch (error) {
      this.reportError(`The native bridge could not accept a command: ${describeError(error)}`)
      return false
    }
  }

  private async launch(awaitingRestartReadiness: boolean): Promise<LaunchOutcome> {
    const binary = await this.resolveBinaryPath()
    if (binary === null) {
      this.available = false
      return { status: 'missing', message: 'The native bridge binary is not available.' }
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnBridge(binary)
    } catch (error) {
      this.available = false
      return {
        status: 'failed',
        message: `The native bridge could not be started: ${describeError(error)}`
      }
    }

    this.child = child
    this.available = true
    this.restartAwaitingReadiness = awaitingRestartReadiness
    this.stdoutLines.reset()
    this.stderrLines.reset()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(child, chunk))
    child.stderr.setEncoding('utf8')
    // Line-buffered exactly like stdout: a chunk boundary is not a message
    // boundary, so an unbuffered handler split one warning across two reports
    // and joined two others into one.
    child.stderr.on('data', (chunk: string) => this.consumeStderr(child, chunk))
    // EACCES / ENOEXEC / ENOENT arrive here, asynchronously, after spawn returns.
    let terminalHandled = false
    child.on('error', (error: Error) => {
      if (terminalHandled || this.child !== child || this.stopping) return
      terminalHandled = true
      this.available = false
      this.child = null
      this.restartAwaitingReadiness = false
      this.stdoutLines.reset()
      this.stderrLines.reset()
      this.failPending('The native bridge stopped unexpectedly.')
      this.handleFailure(`The native bridge failed: ${describeError(error)}.`)
    })
    child.stdin.on('error', (error: Error) => {
      this.reportError(`The native bridge stopped accepting commands: ${describeError(error)}`)
    })
    child.once('exit', (code, signal) => {
      if (terminalHandled) return
      terminalHandled = true
      this.handleChildExit(code, signal)
    })
    return { status: 'started' }
  }

  private handleChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.available = false
    this.child = null
    this.restartAwaitingReadiness = false
    this.stdoutLines.reset()
    this.stderrLines.reset()
    this.failPending('The native bridge stopped unexpectedly.')

    if (this.stopping) {
      this.emit('exit', { code, signal, willRestart: false } satisfies NativeBridgeExit)
      return
    }
    this.handleFailure(
      `The native bridge stopped unexpectedly (${describeExit(code, signal)}).`,
      code,
      signal
    )
  }

  /**
   * Reports the failure, tells listeners whether a respawn is coming, and arms
   * the next backoff step. Shared by an unexpected exit and a failed respawn.
   */
  private handleFailure(
    message: string,
    code: number | null = null,
    signal: NodeJS.Signals | null = null
  ): void {
    const delay = this.restartDelays[this.restartAttempt]
    const willRestart = !this.stopping && delay !== undefined
    this.reportError(
      willRestart
        ? `${message} Restarting (attempt ${this.restartAttempt + 1} of ${this.restartDelays.length}).`
        : `${message} It stays offline until you restart Codex Controller.`
    )
    this.emit('exit', { code, signal, willRestart } satisfies NativeBridgeExit)
    if (!willRestart || delay === undefined) return

    this.restartAttempt += 1
    this.restartTimer = setTimeout(() => void this.attemptRestart(), delay)
    this.restartTimer.unref?.()
  }

  private async attemptRestart(): Promise<void> {
    this.restartTimer = null
    if (this.stopping) return

    const outcome = await this.launch(true)
    if (outcome.status !== 'started') {
      this.handleFailure(outcome.message)
      return
    }
    // A spawned process is not necessarily a usable helper: EACCES/ENOEXEC are
    // delivered asynchronously after spawn returns. Recovery listeners wait
    // for the replacement to produce one well-formed protocol message.
    // The replacement child knows nothing about the renderer's last snapshot,
    // so ask it to publish controller + permission state again.
    this.send('system.refresh')
  }

  private failPending(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ success: false, message })
      this.pending.delete(id)
    }
  }

  private consume(child: ChildProcessWithoutNullStreams, chunk: string): void {
    if (this.child !== child) return
    const { lines, dropped } = this.stdoutLines.take(chunk)
    for (const line of lines) this.consumeLine(line)
    if (dropped) {
      this.reportError('The native bridge sent an oversized message, which was discarded.')
    }
  }

  private consumeLine(line: string): void {
    try {
      const value = JSON.parse(line) as unknown
      if (typeof value !== 'object' || value === null || !('type' in value)) throw new Error()
      const type = (value as { type?: unknown }).type
      if (type === 'response') {
        const response = value as Partial<NativeResponse>
        if (
          typeof response.id !== 'string' ||
          typeof response.success !== 'boolean' ||
          typeof response.message !== 'string'
        ) {
          throw new Error()
        }
      } else {
        if (!['controller', 'permission', 'error', 'log'].includes(String(type))) {
          throw new Error()
        }
        const payload = (value as { payload?: unknown }).payload
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          throw new Error()
        }
        if (
          (type === 'error' || type === 'log') &&
          typeof (payload as { message?: unknown }).message !== 'string'
        ) {
          throw new Error()
        }
      }
      // Well-formed output proves this child is healthy, so a later crash
      // gets the full restart budget instead of the tail of an old one.
      this.restartAttempt = 0
      if (this.restartAwaitingReadiness) {
        this.restartAwaitingReadiness = false
        this.emit('restarted')
      }
      if (type === 'response') {
        const response = value as NativeResponse
        const pending = this.pending.get(response.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(response.id)
          pending.resolve({ success: response.success, message: response.message })
        }
      } else {
        const event = value as NativeBridgeEvent
        if (event.type === 'permission') {
          this.latestPermissions = event.payload as SystemSnapshot
        }
        this.emit('event', event)
      }
    } catch {
      this.reportError('The native bridge returned malformed data.')
    }
  }

  private consumeStderr(child: ChildProcessWithoutNullStreams, chunk: string): void {
    if (this.child !== child) return
    const { lines, dropped } = this.stderrLines.take(chunk)
    for (const line of lines) this.reportLog(line)
    if (dropped) this.reportLog('An oversized diagnostic line was discarded.')
  }
}
