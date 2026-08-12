import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeBridgeEvent } from '../shared/contracts'
import { NativeBridge, type NativeBridgeExit } from './nativeBridge'

// Every case injects its own binary resolution, so `app` is never consulted.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nonexistent' }
}))

class FakeStream extends EventEmitter {
  setEncoding = vi.fn()
}

class FakeStdin extends EventEmitter {
  readonly writes: string[] = []
  throwOnWrite: Error | null = null

  write(chunk: string): boolean {
    if (this.throwOnWrite) throw this.throwOnWrite
    this.writes.push(chunk)
    return true
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new FakeStream()
  readonly stderr = new FakeStream()
  readonly stdin = new FakeStdin()
  readonly kill = vi.fn()

  asChild(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams
  }
}

interface Harness {
  bridge: NativeBridge
  children: FakeChild[]
  errors: string[]
  events: NativeBridgeEvent[]
  exits: NativeBridgeExit[]
  restarts: number
  latest: () => FakeChild
}

const harness = (
  options: {
    delays?: readonly number[]
    missingAfter?: number
    readyOnReplacementSpawn?: boolean
  } = {}
): Harness => {
  const children: FakeChild[] = []
  const events: NativeBridgeEvent[] = []
  const exits: NativeBridgeExit[] = []
  let restarts = 0

  const bridge = new NativeBridge({
    resolveBinaryPath: async () =>
      options.missingAfter !== undefined && children.length >= options.missingAfter
        ? null
        : '/fake/ControllerBridge',
    spawnBridge: () => {
      const child = new FakeChild()
      if (options.readyOnReplacementSpawn && children.length > 0) {
        queueMicrotask(() =>
          child.stdout.emit('data', '{"type":"permission","payload":{}}\n')
        )
      }
      children.push(child)
      return child.asChild()
    },
    restartDelaysMilliseconds: options.delays ?? [500, 2_000, 5_000]
  })

  bridge.on('event', (event: NativeBridgeEvent) => events.push(event))
  bridge.on('exit', (exit: NativeBridgeExit) => exits.push(exit))
  bridge.on('restarted', () => {
    restarts += 1
  })

  return {
    bridge,
    children,
    events,
    exits,
    get restarts() {
      return restarts
    },
    get errors() {
      return events
        .filter((event) => event.type === 'error')
        .map((event) => (event.payload as { message: string }).message)
    },
    latest: () => {
      const child = children[children.length - 1]
      if (!child) throw new Error('no child was spawned')
      return child
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('NativeBridge failure handling', () => {
  it('reports a real spawn failure against a non-executable path as an error event', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-bridge-test-'))
    const binary = join(directory, 'ControllerBridge')
    writeFileSync(binary, 'not a program', 'utf8')
    chmodSync(binary, 0o644)

    const events: NativeBridgeEvent[] = []
    const bridge = new NativeBridge({
      resolveBinaryPath: async () => binary,
      spawnBridge: (path) => spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] }),
      restartDelaysMilliseconds: []
    })
    bridge.on('event', (event: NativeBridgeEvent) => events.push(event))

    // Node reports EACCES asynchronously on the child's own error event; without
    // a handler this is an uncaught exception that takes the main process down.
    await expect(
      new Promise<NativeBridgeEvent>((resolve) => {
        bridge.on('event', resolve)
        void bridge.start()
      })
    ).resolves.toMatchObject({ type: 'error' })

    expect(bridge.isAvailable).toBe(false)
    expect(events.some((event) => event.type === 'error')).toBe(true)
    bridge.stop()
  })

  it('restarts a real non-executable spawn exactly once when one retry is configured', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-bridge-restart-test-'))
    const binary = join(directory, 'ControllerBridge')
    writeFileSync(binary, 'not a program', 'utf8')
    chmodSync(binary, 0o644)
    let spawnAttempts = 0

    const bridge = new NativeBridge({
      resolveBinaryPath: async () => binary,
      spawnBridge: (path) => {
        spawnAttempts += 1
        return spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
      },
      restartDelaysMilliseconds: [5]
    })

    await bridge.start()
    await vi.waitFor(() => expect(spawnAttempts).toBe(2))
    bridge.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(spawnAttempts).toBe(2)
  })

  it('reports a real EPIPE from a write the child can no longer read', async () => {
    // The child closes its end of the pipe and stays alive, which is what a
    // crashed helper looks like to a write that races the exit notification.
    const bridge = new NativeBridge({
      resolveBinaryPath: async () => process.execPath,
      spawnBridge: (path) =>
        spawn(path, ['-e', 'require("fs").closeSync(0); setTimeout(() => {}, 8000)'], {
          stdio: ['pipe', 'pipe', 'pipe']
        }),
      restartDelaysMilliseconds: []
    })
    const errors: string[] = []
    bridge.on('event', (event: NativeBridgeEvent) => {
      if (event.type === 'error') errors.push((event.payload as { message: string }).message)
    })
    await bridge.start()

    // EPIPE surfaces asynchronously, so write until it lands. Without the stdin
    // error handler this would be an uncaught exception in the main process.
    const deadline = Date.now() + 4_000
    while (errors.length === 0 && Date.now() < deadline) {
      expect(() => bridge.send('system.refresh')).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    expect(errors.join(' ')).toContain('The native bridge stopped accepting commands')
    bridge.stop()
  }, 15_000)

  it('turns a stdin error on a dead child into an error event', async () => {
    const context = harness()
    await context.bridge.start()

    const failure = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    expect(() => context.latest().stdin.emit('error', failure)).not.toThrow()

    expect(context.errors).toEqual([
      'The native bridge stopped accepting commands: write EPIPE'
    ])
  })

  it('turns a throwing write into an error event and a false result', async () => {
    const context = harness()
    await context.bridge.start()
    context.latest().stdin.throwOnWrite = new Error('write after end')

    expect(context.bridge.send('system.refresh')).toBe(false)
    expect(context.errors).toEqual([
      'The native bridge could not accept a command: write after end'
    ])
  })

  it('resolves a request whose write fails instead of hanging', async () => {
    const context = harness()
    await context.bridge.start()
    context.latest().stdin.throwOnWrite = new Error('write after end')

    await expect(context.bridge.request('action.execute', {})).resolves.toEqual({
      success: false,
      message: 'The native action bridge is unavailable.'
    })
  })

  it('reports a spawn that throws synchronously', async () => {
    const events: NativeBridgeEvent[] = []
    const bridge = new NativeBridge({
      resolveBinaryPath: async () => '/fake/ControllerBridge',
      spawnBridge: () => {
        throw new Error('ENOEXEC')
      },
      restartDelaysMilliseconds: []
    })
    bridge.on('event', (event: NativeBridgeEvent) => events.push(event))

    await expect(bridge.start()).resolves.toBeUndefined()
    expect(events).toEqual([
      { type: 'error', payload: { message: 'The native bridge could not be started: ENOEXEC' } }
    ])
    expect(bridge.isAvailable).toBe(false)
  })

  it('stays quiet when no bridge binary is built', async () => {
    const context = harness({ missingAfter: 0 })
    await context.bridge.start()

    expect(context.children).toHaveLength(0)
    expect(context.events).toEqual([])
    expect(context.bridge.isAvailable).toBe(false)
  })

  it('fails pending work and enters the bounded restart path on error without exit', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [500] })
    await context.bridge.start()
    const first = context.latest()
    const pending = context.bridge.request('action.execute', {}, 60_000)

    expect(() => first.emit('error', new Error('EACCES'))).not.toThrow()
    await expect(pending).resolves.toEqual({
      success: false,
      message: 'The native bridge stopped unexpectedly.'
    })
    expect(context.errors).toEqual([
      'The native bridge failed: EACCES. Restarting (attempt 1 of 1).'
    ])
    expect(context.exits).toEqual([{ code: null, signal: null, willRestart: true }])
    expect(context.bridge.isAvailable).toBe(false)

    // Some ChildProcess implementations can still surface a terminal event
    // after `error`; it belongs to the same failure and must not spend a second
    // restart slot.
    first.emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(500)

    expect(context.children).toHaveLength(2)
    expect(context.restarts).toBe(0)
    context.latest().stdout.emit('data', '{"type":"permission","payload":{}}\n')
    expect(context.restarts).toBe(1)
    expect(context.exits).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(context.children).toHaveLength(2)
  })
})

describe('NativeBridge restart', () => {
  it('reports an unexpected exit and respawns after the backoff delay', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [500, 2_000] })
    await context.bridge.start()
    const first = context.latest()

    first.emit('exit', 1, null)

    expect(context.errors).toEqual([
      'The native bridge stopped unexpectedly (exit code 1). Restarting (attempt 1 of 2).'
    ])
    expect(context.exits).toEqual([{ code: 1, signal: null, willRestart: true }])
    expect(context.children).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(500)

    expect(context.children).toHaveLength(2)
    expect(context.restarts).toBe(0)
    context.latest().stdout.emit('data', '{"type":"permission","payload":{}}\n')
    expect(context.restarts).toBe(1)
    expect(context.bridge.isAvailable).toBe(true)
  })

  it('waits for valid replacement output before announcing readiness', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [10] })
    await context.bridge.start()
    const first = context.latest()

    first.emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(10)
    const replacement = context.latest()

    expect(context.restarts).toBe(0)
    first.stdout.emit('data', '{"type":"permission","payload":{}}\n')
    replacement.stdout.emit(
      'data',
      'not json\n{"type":"permission"}\n{"type":"response","id":3,"success":true,"message":"ok"}\n'
    )
    expect(context.restarts).toBe(0)

    replacement.stdout.emit('data', '{"type":"permission","payload":{}}\n')
    replacement.stdout.emit('data', '{"type":"log","payload":{"message":"ready"}}\n')
    expect(context.restarts).toBe(1)
  })

  it('announces an immediately ready replacement exactly once', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [10], readyOnReplacementSpawn: true })
    await context.bridge.start()

    context.latest().emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(10)

    expect(context.children).toHaveLength(2)
    expect(context.restarts).toBe(1)
    context.latest().stdout.emit('data', '{"type":"permission","payload":{}}\n')
    expect(context.restarts).toBe(1)
  })

  it('asks the replacement child for a fresh snapshot', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [500] })
    await context.bridge.start()
    context.latest().emit('exit', null, 'SIGSEGV')
    await vi.advanceTimersByTimeAsync(500)

    const written = context.latest().stdin.writes.map(
      (line) => (JSON.parse(line) as { command: string }).command
    )
    expect(written).toEqual(['system.refresh'])
  })

  it('stops after the attempt budget and says so', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [10, 20, 30] })
    await context.bridge.start()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      context.latest().emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(30)
    }
    context.latest().emit('exit', 1, null)

    // One initial child plus exactly three respawns. None became ready before
    // crashing, so no `restarted` lifecycle event was announced.
    expect(context.children).toHaveLength(4)
    expect(context.restarts).toBe(0)
    expect(context.exits.filter((exit) => exit.willRestart)).toHaveLength(3)
    expect(context.exits[3]).toEqual({ code: 1, signal: null, willRestart: false })
    expect(context.errors[3]).toBe(
      'The native bridge stopped unexpectedly (exit code 1). It stays offline until you restart Codex Controller.'
    )

    await vi.advanceTimersByTimeAsync(10_000)
    expect(context.children).toHaveLength(4)
    expect(context.bridge.isAvailable).toBe(false)
  })

  it('keeps trying when a respawn cannot find the binary', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [10, 20], missingAfter: 1 })
    await context.bridge.start()
    context.latest().emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(10)

    expect(context.children).toHaveLength(1)
    expect(context.restarts).toBe(0)
    expect(context.errors[1]).toBe(
      'The native bridge binary is not available. Restarting (attempt 2 of 2).'
    )

    await vi.advanceTimersByTimeAsync(20)
    expect(context.exits[2]?.willRestart).toBe(false)
  })

  it('gives a child that produced healthy output the full budget again', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [10, 20] })
    await context.bridge.start()

    context.latest().emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(10)
    expect(context.exits[0]?.willRestart).toBe(true)

    context.latest().stdout.emit('data', '{"type":"permission","payload":{}}\n')
    context.latest().emit('exit', 1, null)

    // Without the reset this exit would already be attempt two of two.
    expect(context.errors.at(-1)).toContain('attempt 1 of 2')
  })

  it('does not restart or complain after an intentional stop', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [10] })
    await context.bridge.start()
    const child = context.latest()

    context.bridge.stop()
    child.emit('exit', null, 'SIGTERM')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(child.kill).toHaveBeenCalledOnce()
    expect(context.errors).toEqual([])
    expect(context.children).toHaveLength(1)
    expect(context.exits).toEqual([{ code: null, signal: 'SIGTERM', willRestart: false }])
  })

  it('cancels a scheduled respawn when the app quits', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [500] })
    await context.bridge.start()
    context.latest().emit('exit', 1, null)

    context.bridge.stop()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(context.children).toHaveLength(1)
    expect(context.restarts).toBe(0)
  })

  it('fails in-flight requests when the child dies', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()
    const pending = context.bridge.request('action.execute', {}, 60_000)

    context.latest().emit('exit', 1, null)

    await expect(pending).resolves.toEqual({
      success: false,
      message: 'The native bridge stopped unexpectedly.'
    })
  })

  it('refuses to send once the child is gone', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()
    context.latest().emit('exit', 1, null)

    expect(context.bridge.send('system.refresh')).toBe(false)
    await expect(context.bridge.request('action.execute', {})).resolves.toEqual({
      success: false,
      message: 'The native action bridge is unavailable.'
    })
  })
})

describe('NativeBridge output parsing', () => {
  it('forwards events, caches permissions, and reports malformed lines', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()

    context
      .latest()
      .stdout.emit('data', '{"type":"permission","payload":{"codexRunning":true}}\nnot json\n')

    expect(context.bridge.systemSnapshot).toEqual({ codexRunning: true })
    expect(context.events[0]).toEqual({
      type: 'permission',
      payload: { codexRunning: true }
    })
    expect(context.errors).toEqual(['The native bridge returned malformed data.'])
  })

  it('re-joins a JSON line split across two chunks', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()

    context.latest().stdout.emit('data', '{"type":"permission","payl')
    expect(context.events).toEqual([])
    context.latest().stdout.emit('data', 'oad":{"codexRunning":true}}\n')

    expect(context.events).toEqual([{ type: 'permission', payload: { codexRunning: true } }])
    expect(context.errors).toEqual([])
  })

  it('drops an unterminated stdout line past the cap instead of growing forever', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()

    // One report for the overrun, not one per chunk of it.
    context.latest().stdout.emit('data', 'x'.repeat(70 * 1024))
    context.latest().stdout.emit('data', 'x'.repeat(70 * 1024))

    expect(context.errors).toEqual([
      'The native bridge sent an oversized message, which was discarded.'
    ])

    // The next newline resynchronises: the truncated head is not reported as
    // malformed data, and the line after it parses normally.
    context.latest().stdout.emit('data', 'tail\n{"type":"permission","payload":{}}\n')

    expect(context.errors).toHaveLength(1)
    expect(context.events.at(-1)).toEqual({ type: 'permission', payload: {} })
  })
})

describe('NativeBridge stderr', () => {
  // The point of the change is that stderr reaches the log; asserting on the
  // events is the check, and the console copy would only be noise here.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.mocked(console.warn).mockRestore()
  })

  /**
   * The Swift helper's stderr is CoreAudio and IOHIDManager chatter the user
   * can do nothing about. Raising it on the `error` channel filled the app with
   * warnings that looked like Codex Controller failures.
   */
  it('keeps stderr off the user-facing error channel', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()

    context.latest().stderr.emit('data', '  bridge said no\n')

    expect(context.errors).toEqual([])
    expect(context.events).toEqual([{ type: 'log', payload: { message: 'bridge said no' } }])
  })

  it('line-buffers stderr rather than reporting chunk boundaries', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()

    context.latest().stderr.emit('data', 'first half ')
    expect(context.events).toEqual([])
    context.latest().stderr.emit('data', 'of one line\nsecond line\npartial')

    expect(context.events).toEqual([
      { type: 'log', payload: { message: 'first half of one line' } },
      { type: 'log', payload: { message: 'second line' } }
    ])
  })

  it('caps the stderr buffer and says so once', async () => {
    const context = harness({ delays: [] })
    await context.bridge.start()

    context.latest().stderr.emit('data', 'y'.repeat(70 * 1024))
    context.latest().stderr.emit('data', 'y'.repeat(70 * 1024))
    context.latest().stderr.emit('data', 'tail\nafter\n')

    expect(context.errors).toEqual([])
    expect(context.events).toEqual([
      { type: 'log', payload: { message: 'An oversized diagnostic line was discarded.' } },
      { type: 'log', payload: { message: 'after' } }
    ])
  })

  it('starts a replacement child with an empty stderr buffer', async () => {
    vi.useFakeTimers()
    const context = harness({ delays: [10] })
    await context.bridge.start()

    context.latest().stderr.emit('data', 'half a line without a newline')
    context.latest().emit('exit', 1, null)
    await vi.advanceTimersByTimeAsync(10)
    context.latest().stderr.emit('data', 'fresh\n')

    expect(
      context.events.filter((event) => event.type === 'log').map((event) => event.payload)
    ).toEqual([{ message: 'fresh' }])
  })
})
