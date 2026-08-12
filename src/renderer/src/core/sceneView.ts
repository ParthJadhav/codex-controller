import { approachValue } from './animationSettle'

export interface ControllerSceneView {
  yaw: number
  pitch: number
  zoom: number
}

export const defaultControllerSceneView: ControllerSceneView = {
  yaw: 0,
  pitch: 0,
  zoom: 1
}

export const controllerSceneViewLimits = {
  pitch: 0.32,
  minimumZoom: 0.88,
  maximumZoom: 1.12
} as const

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

export const orbitControllerScene = (
  start: ControllerSceneView,
  deltaX: number,
  deltaY: number
): ControllerSceneView => ({
  ...start,
  yaw: start.yaw + deltaX * 0.006,
  pitch: clamp(
    start.pitch + deltaY * 0.0045,
    -controllerSceneViewLimits.pitch,
    controllerSceneViewLimits.pitch
  )
})

export const zoomControllerScene = (
  start: ControllerSceneView,
  wheelDeltaY: number
): ControllerSceneView => ({
  ...start,
  zoom: clamp(
    start.zoom - wheelDeltaY * 0.0007,
    controllerSceneViewLimits.minimumZoom,
    controllerSceneViewLimits.maximumZoom
  )
})

/**
 * Advance the rendered view one frame toward the target view. `changed` is
 * false once every axis has landed, which lets the render loop go idle.
 */
export const settleControllerSceneView = (
  rendered: ControllerSceneView,
  target: ControllerSceneView,
  response: number
): { view: ControllerSceneView; changed: boolean } => {
  const view: ControllerSceneView = {
    yaw: approachValue(rendered.yaw, target.yaw, response),
    pitch: approachValue(rendered.pitch, target.pitch, response),
    zoom: approachValue(rendered.zoom, target.zoom, response)
  }
  return {
    view,
    changed:
      view.yaw !== rendered.yaw ||
      view.pitch !== rendered.pitch ||
      view.zoom !== rendered.zoom
  }
}

export const controllerSceneViewChanged = (view: ControllerSceneView): boolean =>
  Math.abs(view.yaw) > 0.001 ||
  Math.abs(view.pitch) > 0.001 ||
  Math.abs(view.zoom - 1) > 0.001
