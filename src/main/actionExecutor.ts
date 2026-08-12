import { shell, systemPreferences } from 'electron'
import type { ActionRequest, ActionResult } from '../shared/contracts'
import type { NativeBridge, NativeBridgeExit } from './nativeBridge'

const success = (message: string): ActionResult => ({ status: 'success', message })
const failure = (message: string): ActionResult => ({ status: 'failure', message })
const permission = (message: string): ActionResult => ({
  status: 'permissionNeeded',
  message
})

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const nativeActionTimeoutMilliseconds = 180_000
const nativeActionHeadroomMilliseconds = 10_000
const maximumSequenceExecutionBudgetMilliseconds =
  nativeActionTimeoutMilliseconds - nativeActionHeadroomMilliseconds
// Every native sequence step crosses an async dispatch boundary and may need
// to activate Codex (140 ms in the native sink). Keep a conservative allowance
// in addition to the explicit delay so a large zero-delay tree cannot fall back
// to the twelve-second floor and keep running after main reports a timeout.
const nativeSequenceStepOverheadMilliseconds = 200
// A holdShortcut nested in a sequence has no later holdEnded gesture, so native
// deliberately holds it for 60 ms before posting key-up.
const nativeSequenceHoldMilliseconds = 60

interface NativeActionOutcome {
  success: boolean
  message: string
}

const holdKey = (action: ActionRequest['action']): string =>
  JSON.stringify([
    action.shortcut?.keyCode,
    [...new Set(action.shortcut?.modifiers ?? [])].sort()
  ])

const holdOwner = (request: ActionRequest): string =>
  request.bindingId ? `binding:${request.bindingId}` : 'anonymous'

interface HeldShortcutState {
  key: string
  request: ActionRequest
  holders: Map<string, number>
  holderCount: number
  begin: Promise<NativeActionOutcome>
  releaseNeeded: boolean
  releaseInFlight?: Promise<NativeActionOutcome>
}

export class ActionExecutor {
  private armed:
    | {
        fingerprint: string
        expiresAt: number
      }
    | undefined

  /**
   * Held shortcuts whose key-down the bridge has posted with no key-up yet.
   * A bridge crash here strands a modifier combination down system-wide, so the
   * key-up is replayed against the replacement child (or reported if there is none).
   */
  private readonly heldShortcuts = new Map<string, HeldShortcutState>()
  private acceptingNewHolds = true

  constructor(private readonly nativeBridge: NativeBridge) {
    nativeBridge.on('exit', (exit: NativeBridgeExit) => this.handleBridgeExit(exit))
    nativeBridge.on('restarted', () => void this.releaseStrandedShortcuts())
  }

  /** Held shortcuts still waiting for their key-up. */
  get heldShortcutCount(): number {
    return this.heldShortcuts.size
  }

  /**
   * Replays the key-up half of every in-flight hold. Called when the bridge
   * comes back, because the crashed child left the keys logically down.
   */
  async releaseHeldShortcuts(
    timeoutMilliseconds?: number,
    forceNewAttempt = false
  ): Promise<void> {
    await this.releaseShortcutStates(
      [...this.heldShortcuts.values()],
      timeoutMilliseconds,
      forceNewAttempt
    )
  }

  /**
   * A replacement helper only inherits cleanup obligations from the child that
   * crashed. Holds started against the replacement before its first readiness
   * message are live work and must remain held.
   */
  private async releaseStrandedShortcuts(): Promise<void> {
    await this.releaseShortcutStates(
      [...this.heldShortcuts.values()].filter((state) => state.releaseNeeded)
    )
  }

  private async releaseShortcutStates(
    states: HeldShortcutState[],
    timeoutMilliseconds?: number,
    forceNewAttempt = false
  ): Promise<void> {
    for (const state of states) {
      // Recovery and shutdown release the system key regardless of whether the
      // physical control is still down. The old helper's key-down cannot be
      // allowed to survive its process lifetime.
      state.holders.clear()
      state.holderCount = 0
      state.releaseNeeded = true
    }
    const results = await Promise.all(
      states.map((state) =>
        this.releaseHeldShortcut(state, timeoutMilliseconds, forceNewAttempt)
      )
    )
    for (const [index, result] of results.entries()) {
      if (result.success) continue
      this.nativeBridge.reportError(
        `${states[index]!.request.action.title} may still be held down: ${result.message}`
      )
    }
  }

  /**
   * Atomically closes the hold gate before taking the release snapshot.
   * A holdBegan already awaiting native has reserved its state in the map; a
   * later one is refused, so shutdown cannot miss a key-down between snapshot
   * and bridge teardown.
   */
  async prepareForShutdown(timeoutMilliseconds: number): Promise<void> {
    this.acceptingNewHolds = false
    await this.releaseHeldShortcuts(timeoutMilliseconds, true)
  }

  private sequenceExecutionBudgetMilliseconds(action: ActionRequest['action']): number {
    let total = 0
    const pending = [action]
    while (pending.length > 0) {
      const candidate = pending.pop()!
      if (candidate.type !== 'sequence') continue
      for (const step of candidate.sequenceSteps ?? []) {
        total += step.delayMilliseconds + nativeSequenceStepOverheadMilliseconds
        if (step.action.type === 'holdShortcut') total += nativeSequenceHoldMilliseconds
        if (total > maximumSequenceExecutionBudgetMilliseconds) return total
        pending.push(step.action)
      }
    }
    return total
  }

  private handleBridgeExit(exit: NativeBridgeExit): void {
    if (this.heldShortcuts.size === 0) return
    const states = [...this.heldShortcuts.values()]
    for (const state of states) {
      // This child's holders no longer represent a live key-down operation.
      // Clearing them also lets a same-chord press during the restart window
      // await this key-up and then reserve a fresh state on the replacement.
      state.holders.clear()
      state.holderCount = 0
      state.releaseNeeded = true
      // `NativeBridge` fails every request before emitting `exit`. Invalidate
      // that child's release operation now so the ready replacement gets a new
      // one even if the old promise's continuation has not run yet.
      state.releaseInFlight = undefined
    }
    const titles = states.map((state) => state.request.action.title).join(', ')
    if (exit.willRestart) {
      this.nativeBridge.reportError(
        `The native bridge stopped while holding ${titles}. The key is released as soon as it restarts.`
      )
      return
    }
    this.nativeBridge.reportError(
      `The native bridge stopped while holding ${titles} and cannot release it. Tap the key once if it stays down.`
    )
  }

  private releaseHeldShortcut(
    state: HeldShortcutState,
    timeoutMilliseconds?: number,
    forceNewAttempt = false
  ): Promise<NativeActionOutcome> {
    state.releaseNeeded = true
    if (state.releaseInFlight && !forceNewAttempt) return state.releaseInFlight
    if (forceNewAttempt) state.releaseInFlight = undefined

    let requested: Promise<NativeActionOutcome>
    try {
      requested = this.nativeBridge.request(
        'action.execute',
        { ...state.request, gesture: 'holdEnded' } satisfies ActionRequest,
        timeoutMilliseconds ?? this.timeoutFor(state.request.action)
      )
    } catch (error) {
      requested = Promise.resolve({ success: false, message: describeError(error) })
    }

    const operation = requested.then(
      (result) => {
        const current = state.releaseInFlight === operation
        if (current) state.releaseInFlight = undefined
        if (
          current &&
          result.success &&
          state.holderCount === 0 &&
          this.heldShortcuts.get(state.key) === state
        ) {
          state.releaseNeeded = false
          this.heldShortcuts.delete(state.key)
        }
        return result
      },
      (error: unknown) => {
        if (state.releaseInFlight === operation) state.releaseInFlight = undefined
        return { success: false, message: describeError(error) }
      }
    )
    state.releaseInFlight = operation
    return operation
  }

  private async beginHeldShortcut(request: ActionRequest): Promise<ActionResult> {
    if (!this.acceptingNewHolds) {
      return failure('A new held shortcut cannot start while the app is quitting.')
    }

    const key = holdKey(request.action)
    let state = this.heldShortcuts.get(key)
    if (state && state.holderCount === 0) {
      const released = await this.releaseHeldShortcut(state)
      if (!released.success) {
        return failure(
          `${request.action.title} cannot start until its previous key-up succeeds: ${released.message}`
        )
      }
      if (!this.acceptingNewHolds) {
        return failure('A new held shortcut cannot start while the app is quitting.')
      }
      state = this.heldShortcuts.get(key)
    }

    const owner = holdOwner(request)
    if (!state) {
      // Reserve before the first await. Shutdown sees this intent even when the
      // native key-down response is still in flight.
      state = {
        key,
        request,
        holders: new Map([[owner, 1]]),
        holderCount: 1,
        begin: Promise.resolve({ success: false, message: 'The hold has not started.' }),
        releaseNeeded: false
      }
      this.heldShortcuts.set(key, state)
      try {
        state.begin = this.nativeBridge
          .request('action.execute', request, this.timeoutFor(request.action))
          .catch((error: unknown) => ({ success: false, message: describeError(error) }))
      } catch (error) {
        state.begin = Promise.resolve({ success: false, message: describeError(error) })
      }
    } else {
      state.holders.set(owner, (state.holders.get(owner) ?? 0) + 1)
      state.holderCount += 1
    }

    const result = await state.begin
    if (
      !result.success &&
      !state.releaseNeeded &&
      this.heldShortcuts.get(key) === state
    ) {
      this.heldShortcuts.delete(key)
    }
    return result.success ? success(result.message) : failure(result.message)
  }

  private async endHeldShortcut(request: ActionRequest): Promise<ActionResult> {
    const key = holdKey(request.action)
    let state = this.heldShortcuts.get(key)
    if (!state) {
      // A cleanup request is useful even when main lost its bookkeeping (for
      // example after an older build crashed). Keep it as release intent until
      // native confirms the key-up.
      state = {
        key,
        request,
        holders: new Map(),
        holderCount: 0,
        begin: Promise.resolve({ success: true, message: 'No tracked key-down.' }),
        releaseNeeded: true
      }
      this.heldShortcuts.set(key, state)
    } else {
      const owner = holdOwner(request)
      const ownerCount = state.holders.get(owner) ?? 0
      if (ownerCount > 1) state.holders.set(owner, ownerCount - 1)
      else if (ownerCount === 1) state.holders.delete(owner)
      if (ownerCount > 0) state.holderCount -= 1
      if (state.holderCount > 0) {
        return success(`${request.action.title} remains held.`)
      }
    }

    const result = await this.releaseHeldShortcut(state)
    return result.success ? success(result.message) : failure(result.message)
  }

  async execute(request: ActionRequest): Promise<ActionResult> {
    const { action } = request
    // Key-up is unconditional cleanup. It must bypass Accessibility checks and
    // consequential arming alike; either can change after the matching key-down.
    if (action.type === 'holdShortcut' && request.gesture === 'holdEnded') {
      return this.endHeldShortcut(request)
    }
    if (this.effectiveSafety(action, request.safety) === 'consequential') {
      if (!request.gesture || !['longPress', 'doubleTap', 'chord'].includes(request.gesture)) {
        return failure('Consequential actions require a long press, double tap, or chord.')
      }
      if (request.confirmationPolicy !== 'deliberateGestureOnly') {
        const fingerprint = JSON.stringify({ action, focusPolicy: request.focusPolicy })
        if (this.armed?.fingerprint !== fingerprint || this.armed.expiresAt < Date.now()) {
          this.armed = { fingerprint, expiresAt: Date.now() + 5_000 }
          return {
            status: 'warning',
            message: `Armed ${action.title}. Repeat the deliberate gesture within five seconds to confirm.`
          }
        }
        this.armed = undefined
      }
    }
    switch (action.type) {
      case 'none':
        return { status: 'warning', message: 'This control is unassigned.' }
      case 'deepLink':
        if (!action.deepLinkURL) return failure('The action has no URL.')
        if (!action.deepLinkURL.toLowerCase().startsWith('codex://')) {
          return failure('Only codex:// links are accepted for Codex deep-link actions.')
        }
        try {
          await shell.openExternal(action.deepLinkURL)
          return success(`Opened ${action.title}.`)
        } catch (error) {
          return failure(`Could not open ${action.title}: ${describeError(error)}`)
        }
      case 'openWebURL': {
        if (!action.deepLinkURL) return failure('The action has no URL.')
        let url: URL
        try {
          url = new URL(action.deepLinkURL)
        } catch {
          return failure('The web URL is invalid.')
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
          return failure('Only HTTP and HTTPS URLs can be opened.')
        }
        try {
          await shell.openExternal(url.toString())
          return success(`Opened ${action.title}.`)
        } catch (error) {
          return failure(`Could not open ${action.title}: ${describeError(error)}`)
        }
      }
      case 'layerShift':
        return success(action.targetLayer ? `${action.targetLayer} layer active.` : 'Layer active.')


      case 'holdShortcut':
        // The hold is only meaningful as a pair. Anything other than the two
        // hold gestures would press a key with nothing to release it.
        if (request.gesture !== 'holdBegan' && request.gesture !== 'holdEnded') {
          return failure('A held shortcut needs the Start holding or Stop holding gesture.')
        }
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
          return permission('Accessibility permission is required to dispatch this action.')
        }
        return this.beginHeldShortcut(request)
      case 'keyboardShortcut':
      case 'textInsertion':
      case 'primaryClick':
      case 'sequence':
        if (
          action.type === 'sequence' &&
          this.sequenceExecutionBudgetMilliseconds(action) >
            maximumSequenceExecutionBudgetMilliseconds
        ) {
          return failure(
            'This sequence is too long to run safely. Shorten it or split it into smaller sequences.'
          )
        }
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
          return permission('Accessibility permission is required to dispatch this action.')
        }
        {
          const result = await this.nativeBridge.request(
            'action.execute',
            request,
            this.timeoutFor(action)
          )
          return result.success ? success(result.message) : failure(result.message)
        }
      default: {
        // Unreachable while every `ActionType` has a case above, and the point
        // is to keep it that way: adding a type to the contract without a case
        // here is a compile error rather than a dispatch that falls off the end
        // of the switch and answers the renderer with `undefined`.
        const unhandled: never = action.type
        return failure(`"${String(unhandled)}" is not an action this build can run.`)
      }
    }
  }


  private effectiveSafety(
    action: ActionRequest['action'],
    declared: ActionRequest['safety']
  ): ActionRequest['safety'] {
    if (declared === 'consequential') return declared
    if (
      action.type === 'sequence' &&
      action.sequenceSteps?.some(
        (step) => this.effectiveSafety(step.action, step.safety) === 'consequential'
      )
    ) {
      return 'consequential'
    }
    return 'normal'
  }

  private timeoutFor(action: ActionRequest['action']): number {
    if (action.type !== 'sequence') return 12_000
    const executionBudget = this.sequenceExecutionBudgetMilliseconds(action)
    return Math.max(12_000, executionBudget + nativeActionHeadroomMilliseconds)
  }
}
