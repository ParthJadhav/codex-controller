import type { ControllerInputId } from '@shared/contracts'

export const STICK_VISUAL_DEAD_ZONE = 0.08
export const STICK_MAX_TRANSLATION = 0.028
export const STICK_MAX_TILT_RADIANS = 0.18

export interface StickVector {
  x: number
  y: number
  magnitude: number
}

type ActiveValues = Partial<Record<ControllerInputId, number>>
type StickSide = 'left' | 'right'

const clampUnit = (value: number): number => Math.min(Math.max(value, -1), 1)

export const applyRadialDeadZone = (
  x: number,
  y: number,
  deadZone = STICK_VISUAL_DEAD_ZONE
): StickVector => {
  const clampedX = clampUnit(x)
  const clampedY = clampUnit(y)
  const rawMagnitude = Math.min(Math.hypot(clampedX, clampedY), 1)
  const safeDeadZone = Math.min(Math.max(deadZone, 0), 0.95)
  if (rawMagnitude <= safeDeadZone || rawMagnitude === 0) {
    return { x: 0, y: 0, magnitude: 0 }
  }

  const magnitude = (rawMagnitude - safeDeadZone) / (1 - safeDeadZone)
  const scale = magnitude / rawMagnitude
  return {
    x: clampedX * scale,
    y: clampedY * scale,
    magnitude
  }
}

export const stickVectorFromActiveValues = (
  side: StickSide,
  values: ActiveValues,
  deadZone = STICK_VISUAL_DEAD_ZONE
): StickVector => {
  const prefix = side === 'left' ? 'leftStick' : 'rightStick'
  const x = (values[`${prefix}Right` as ControllerInputId] ?? 0) -
    (values[`${prefix}Left` as ControllerInputId] ?? 0)
  const y = (values[`${prefix}Up` as ControllerInputId] ?? 0) -
    (values[`${prefix}Down` as ControllerInputId] ?? 0)
  return applyRadialDeadZone(x, y, deadZone)
}
