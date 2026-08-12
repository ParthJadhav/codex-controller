/**
 * Shared convergence helper for the controller scene's exponential smoothing.
 *
 * Plain `current += (target - current) * response` approaches its target
 * asymptotically and never lands on it, so an animation loop can never tell
 * "still moving" from "arrived". Snapping once the remaining distance is below
 * a perceptual threshold makes convergence finite, which is what lets the
 * renderer stop submitting frames when the scene is at rest.
 */
export const SETTLE_EPSILON = 0.0002

/**
 * Move `current` one step toward `target`, snapping to `target` once the step
 * leaves less than {@link SETTLE_EPSILON} to travel. A `response` of 1 or more
 * jumps straight to the target (used for reduced-motion).
 */
export const approachValue = (current: number, target: number, response: number): number => {
  if (response >= 1) return target
  const next = current + (target - current) * response
  return Math.abs(target - next) <= SETTLE_EPSILON ? target : next
}
