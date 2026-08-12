/**
 * Who currently needs controller input to stop being turned into actions.
 *
 * The shortcut recorder is the reason this exists: while it is listening for a
 * keystroke, a controller press must not also fire the mapping it is bound to —
 * recording a new key for "submit" should not submit. The recorder is rendered
 * several components below the hook that owns dispatch, so rather than thread a
 * callback through every intermediate component, both ends talk to this tiny
 * store: the recorder claims a suspension while it records, the hook subscribes
 * and closes its gate.
 *
 * A count rather than a flag, because two claims must not cancel each other out
 * when the first one is released.
 */
class ControllerInputSuspension {
  private claims = 0
  private listeners = new Set<(suspended: boolean) => void>()

  get suspended(): boolean {
    return this.claims > 0
  }

  /** Claims a suspension; call the returned function exactly once to drop it. */
  claim(): () => void {
    this.claims += 1
    if (this.claims === 1) this.publish()
    let released = false
    return () => {
      if (released) return
      released = true
      this.claims -= 1
      if (this.claims === 0) this.publish()
    }
  }

  subscribe(listener: (suspended: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.suspended)
  }
}

export const controllerInputSuspension = new ControllerInputSuspension()
