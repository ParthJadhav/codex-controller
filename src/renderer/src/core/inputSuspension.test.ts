import { afterEach, describe, expect, it, vi } from 'vitest'
import { controllerInputSuspension } from './inputSuspension'

describe('controller input suspension', () => {
  afterEach(() => expect(controllerInputSuspension.suspended).toBe(false))

  it('publishes only the edges of suspension, not every claim', () => {
    const seen: boolean[] = []
    const unsubscribe = controllerInputSuspension.subscribe((suspended) => seen.push(suspended))

    const first = controllerInputSuspension.claim()
    const second = controllerInputSuspension.claim()
    first()
    expect(controllerInputSuspension.suspended).toBe(true)
    second()

    expect(seen).toEqual([true, false])
    unsubscribe()
  })

  /**
   * Two claims must not cancel each other out: the second recorder to start
   * listening should not be un-suspended when the first one stops.
   */
  it('stays suspended while any claim is outstanding', () => {
    const first = controllerInputSuspension.claim()
    const second = controllerInputSuspension.claim()

    first()
    expect(controllerInputSuspension.suspended).toBe(true)
    second()
    expect(controllerInputSuspension.suspended).toBe(false)
  })

  it('ignores a claim released twice', () => {
    const release = controllerInputSuspension.claim()
    const other = controllerInputSuspension.claim()

    release()
    release()

    expect(controllerInputSuspension.suspended).toBe(true)
    other()
  })

  it('stops telling a listener that has unsubscribed', () => {
    const listener = vi.fn()
    controllerInputSuspension.subscribe(listener)()

    controllerInputSuspension.claim()()

    expect(listener).not.toHaveBeenCalled()
  })
})
