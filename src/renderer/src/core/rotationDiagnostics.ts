import type { ControllerInputId } from '@shared/contracts'
import { stickVectorFromActiveValues } from './stickMotion'
import { STICK_ROTATION_MINIMUM_MAGNITUDE, type RotationStep } from './stickRotation'

/**
 * Evidence for the physical rotation discriminator.
 *
 * The Input monitor already shows hardware edges, which answers "does the stick
 * publish samples at all". It cannot answer "did those samples become a
 * rotation step", because steps are recovered in the renderer and go straight
 * into the gesture pipeline. Without that second answer, a stick that publishes
 * cleanly but never completes a step is indistinguishable from one whose step
 * fired and reached an app that had nothing bound — and those two findings have
 * opposite fixes. Everything here exists to separate them.
 */

export type RotationStickId = 'leftStickClick' | 'rightStickClick'

export const rotationStickSides = {
  leftStickClick: 'left',
  rightStickClick: 'right'
} as const satisfies Record<RotationStickId, 'left' | 'right'>

export interface StickTelemetry {
  x: number
  y: number
  magnitude: number
  /** Screen convention: 0 right, 90 up, 180 left, -90 down. */
  angleDegrees: number
  /** Whether the stick is deflected far enough for the tracker to read angles. */
  tracking: boolean
  /** Signed travel banked toward the next step, in degrees. */
  bankedDegrees: number
  rejectedSamples: number
}

export interface RotationTraceEntry {
  id: string
  input: RotationStickId
  step: RotationStep
  timestamp: number
  magnitude: number
  angleDegrees: number
}

export interface RotationCounts {
  clockwise: number
  counterclockwise: number
}

const DEGREES_PER_RADIAN = 180 / Math.PI

/**
 * Newest first, matching the Input monitor beside it, and counted **per
 * stick**.
 *
 * One shared 24-entry window let a busy stick evict the other's history: turn
 * L3 two dozen times after R3 finally produced a step and R3's card reads
 * "0 CW · 0 CCW — no step yet", which is the opposite of what was observed and
 * sends the handoff down the wrong row. Each stick keeps its own window so one
 * cannot answer for the other.
 */
export const ROTATION_TRACE_LIMIT = 24

export const stickTelemetry = (
  side: 'left' | 'right',
  values: Partial<Record<ControllerInputId, number>>,
  banked = 0,
  rejectedSamples = 0
): StickTelemetry => {
  const vector = stickVectorFromActiveValues(side, values)
  return {
    x: vector.x,
    y: vector.y,
    magnitude: vector.magnitude,
    // atan2 of a centred stick is 0, which would read as "pointing right".
    // Report it as 0 but let `tracking` say the angle means nothing yet.
    angleDegrees: vector.magnitude === 0 ? 0 : Math.atan2(vector.y, vector.x) * DEGREES_PER_RADIAN,
    tracking: vector.magnitude >= STICK_ROTATION_MINIMUM_MAGNITUDE,
    bankedDegrees: banked * DEGREES_PER_RADIAN,
    rejectedSamples
  }
}

export const appendRotationTrace = (
  trace: readonly RotationTraceEntry[],
  entry: RotationTraceEntry,
  limit = ROTATION_TRACE_LIMIT
): RotationTraceEntry[] => {
  const kept = new Map<RotationStickId, number>()
  return [entry, ...trace].filter((candidate) => {
    const seen = (kept.get(candidate.input) ?? 0) + 1
    kept.set(candidate.input, seen)
    return seen <= limit
  })
}

export const rotationCounts = (
  trace: readonly RotationTraceEntry[],
  input: RotationStickId
): RotationCounts => {
  let clockwise = 0
  let counterclockwise = 0
  for (const entry of trace) {
    if (entry.input !== input) continue
    if (entry.step === 'clockwise') clockwise += 1
    else counterclockwise += 1
  }
  return { clockwise, counterclockwise }
}

/**
 * The one line the discriminator is actually after, phrased so it can be pasted
 * straight into the handoff rather than re-interpreted.
 */
export const rotationVerdict = (
  telemetry: StickTelemetry,
  counts: RotationCounts,
  everTracked: boolean
): string => {
  if (counts.clockwise > 0 || counts.counterclockwise > 0) {
    return 'Detection works — samples and rotation steps both observed'
  }
  if (telemetry.rejectedSamples > 0) {
    return 'Samples arrive but jump too far between reads — sample cadence issue'
  }
  if (everTracked) {
    return 'Deflection reached, no step yet — keep turning one full circle'
  }
  if (telemetry.magnitude > 0) {
    return 'Samples arrive but stay under the rotation threshold — push further out'
  }
  return 'No stick samples yet'
}
