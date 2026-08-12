import { describe, expect, it } from 'vitest'
import {
  controllerSceneViewChanged,
  controllerSceneViewLimits,
  defaultControllerSceneView,
  orbitControllerScene,
  settleControllerSceneView,
  zoomControllerScene
} from './sceneView'

describe('controller scene view', () => {
  it('allows full horizontal rotation while constraining vertical pitch', () => {
    expect(orbitControllerScene(defaultControllerSceneView, 40, -20)).toMatchObject({
      yaw: 0.24,
      pitch: -0.09
    })
    const backView = orbitControllerScene(defaultControllerSceneView, Math.PI / 0.006, 0)
    const fullTurn = orbitControllerScene(backView, Math.PI / 0.006, 0)
    expect(backView.yaw).toBeCloseTo(Math.PI)
    expect(fullTurn.yaw).toBeCloseTo(Math.PI * 2)
    expect(orbitControllerScene(defaultControllerSceneView, 10_000, -10_000)).toMatchObject({
      yaw: 60,
      pitch: -controllerSceneViewLimits.pitch
    })
  })

  it('keeps wheel zoom inside a useful inspection range', () => {
    expect(zoomControllerScene(defaultControllerSceneView, -100).zoom).toBeCloseTo(1.07)
    expect(zoomControllerScene(defaultControllerSceneView, -10_000).zoom).toBe(
      controllerSceneViewLimits.maximumZoom
    )
    expect(zoomControllerScene(defaultControllerSceneView, 10_000).zoom).toBe(
      controllerSceneViewLimits.minimumZoom
    )
  })

  it('only reports a changed view after a meaningful transform', () => {
    expect(controllerSceneViewChanged(defaultControllerSceneView)).toBe(false)
    expect(controllerSceneViewChanged({ ...defaultControllerSceneView, yaw: 0.1 })).toBe(true)
  })

  it('settles onto the target view and then reports no further change', () => {
    const target = { yaw: 0.3, pitch: -0.12, zoom: 1.08 }
    let view = defaultControllerSceneView
    let frames = 0
    let changed = true

    while (changed && frames < 1_000) {
      const step = settleControllerSceneView(view, target, 0.16)
      view = step.view
      changed = step.changed
      frames += 1
    }

    // The render loop stops submitting frames the moment this reports false, so
    // it has to become false — and land on the requested view when it does.
    expect(changed).toBe(false)
    expect(view).toEqual(target)
    expect(frames).toBeLessThan(120)
  })

  it('reports no change when the view is already at the target', () => {
    const step = settleControllerSceneView(defaultControllerSceneView, defaultControllerSceneView, 0.16)

    expect(step.changed).toBe(false)
    expect(step.view).toEqual(defaultControllerSceneView)
  })

  it('reaches the target in a single frame when motion is reduced', () => {
    const target = { yaw: 0.3, pitch: -0.12, zoom: 1.08 }

    const step = settleControllerSceneView(defaultControllerSceneView, target, 1)

    expect(step.changed).toBe(true)
    expect(step.view).toEqual(target)
    expect(settleControllerSceneView(step.view, target, 1).changed).toBe(false)
  })
})
