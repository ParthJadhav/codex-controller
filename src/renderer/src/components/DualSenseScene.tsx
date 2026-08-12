import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'
import { RotateCcw } from 'lucide-react'
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  OrthographicCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  controllerInputIds,
  inputDisplayNames,
  type ControllerInputId
} from '@shared/contracts'
import { physicalInput } from '../core/controllerSurfaces'
import { prepareControllerMaterial } from '../core/controllerMaterials'
import {
  splitDualSenseIntoParts,
  type DualSensePartMesh
} from '../core/dualsenseParts'
import {
  controllerPartEmphasis,
  controllerPartHaloScale,
  controllerPartHighlight,
  controllerPartIsPressed,
  controllerPartTone,
  type ControllerPartTone
} from '../core/controllerVisualState'
import {
  controllerSceneViewChanged,
  defaultControllerSceneView,
  orbitControllerScene,
  settleControllerSceneView,
  zoomControllerScene,
  type ControllerSceneView
} from '../core/sceneView'
import { approachValue } from '../core/animationSettle'
import { disposeSceneResources } from '../core/sceneTeardown'
import {
  STICK_MAX_TILT_RADIANS,
  STICK_MAX_TRANSLATION,
  stickVectorFromActiveValues,
  type StickVector
} from '../core/stickMotion'
import { Button } from './ui/button'

interface DualSenseSceneProps {
  selectedInput: ControllerInputId | null
  activeValuesRef: RefObject<Partial<Record<ControllerInputId, number>>>
  /**
   * Notifies when `activeValuesRef` changes. The scene parks its animation
   * frame when nothing is moving, so controller input has to be pushed in
   * rather than discovered by polling the ref every vsync.
   */
  subscribeActiveValues: (listener: () => void) => () => void
  availableInputs: readonly ControllerInputId[]
  /** Physical inputs with an enabled mapping in the layer being edited. */
  mappedInputs?: ReadonlySet<ControllerInputId>
  /** Physical inputs whose gesture is claimed by more than one mapping. */
  conflictInputs?: ReadonlySet<ControllerInputId>
  onSelect: (input: ControllerInputId) => void
  onDeselect: () => void
  onHover?: (input: ControllerInputId | null) => void
}

const EMPTY_INPUT_SET: ReadonlySet<ControllerInputId> = new Set()

const ACTIVE_BLUE = new Color('#064fe8')
const ACTIVE_EMISSIVE = new Color('#0057ff')
const SYMBOL_IDLE = new Color('#464b55')
const SYMBOL_ACTIVE = new Color('#ffffff')
// Pre-parsed so the animation loop never re-parses a colour string per part.
// The halo is the only selection signal that survives against the white shell,
// so it is what carries state; the material tint is reserved for real presses.
const HALO_COLORS: Record<ControllerPartTone, Color> = {
  selected: new Color('#5b93ff'),
  pointer: new Color('#ffffff'),
  conflict: new Color('#f5a524'),
  mapped: new Color('#4c6ea8'),
  none: new Color('#4c6ea8')
}
const PRESS_DEPTH = 0.008
// World-space box the camera must always keep visible: the controller model is
// roughly 0.40 x 0.25, and this leaves a small margin around it. FIT_HEIGHT is
// what a wide stage uses; FIT_WIDTH only takes over once the stage is narrow
// enough that fitting by height alone would crop the grips.
const FIT_WIDTH = 0.43
const FIT_HEIGHT = 0.292
const PART_RESPONSE = 0.46
const HIGHLIGHT_RESPONSE = 0.18
const VIEW_RESPONSE = 0.16

const inputsByPhysicalInput = new Map<ControllerInputId, ControllerInputId[]>()
for (const candidate of controllerInputIds) {
  const input = physicalInput(candidate)
  const inputs = inputsByPhysicalInput.get(input) ?? []
  inputs.push(candidate)
  inputsByPhysicalInput.set(input, inputs)
}

const activeValueForPhysicalInput = (
  input: ControllerInputId,
  values: Partial<Record<ControllerInputId, number>>
): number => {
  let activeValue = 0
  for (const candidate of inputsByPhysicalInput.get(input) ?? [input]) {
    activeValue = Math.max(activeValue, values[candidate] ?? 0)
  }
  return activeValue
}

const resolveStickDrag = (
  input: ControllerInputId,
  deltaX: number,
  deltaY: number
): ControllerInputId => {
  if (Math.hypot(deltaX, deltaY) < 9) return input
  const left = input === 'leftStickClick'
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (left) return deltaX < 0 ? 'leftStickLeft' : 'leftStickRight'
    return deltaX < 0 ? 'rightStickLeft' : 'rightStickRight'
  }
  if (left) return deltaY < 0 ? 'leftStickUp' : 'leftStickDown'
  return deltaY < 0 ? 'rightStickUp' : 'rightStickDown'
}

/**
 * Advance one part toward its target state. Returns whether anything actually
 * changed this frame — the render loop uses that to decide if another frame is
 * needed, so a scene at rest submits no work at all.
 */
const animatePart = (
  part: DualSensePartMesh,
  targetHighlight: number,
  targetEmphasis: number,
  tone: ControllerPartTone,
  pressed: boolean,
  focused: boolean,
  reducedMotion: boolean,
  stickVector?: StickVector
): boolean => {
  const response = reducedMotion ? 1 : PART_RESPONSE
  const previousHighlight = part.highlight
  const previousEmphasis = part.emphasis
  const previousX = part.mesh.position.x
  const previousY = part.mesh.position.y
  const previousZ = part.mesh.position.z
  const previousRotationX = part.mesh.rotation.x
  const previousRotationY = part.mesh.rotation.y

  part.highlight = approachValue(
    part.highlight,
    targetHighlight,
    reducedMotion ? 1 : HIGHLIGHT_RESPONSE
  )
  part.emphasis = approachValue(
    part.emphasis,
    targetEmphasis,
    reducedMotion ? 1 : HIGHLIGHT_RESPONSE
  )
  const amount = part.highlight
  const targetX = part.restPosition.x + (stickVector?.x ?? 0) * STICK_MAX_TRANSLATION
  const targetY = part.restPosition.y + (stickVector?.y ?? 0) * STICK_MAX_TRANSLATION
  const targetDepth = part.restPosition.z - (pressed ? PRESS_DEPTH : 0)
  part.mesh.position.x = approachValue(previousX, targetX, response)
  part.mesh.position.y = approachValue(previousY, targetY, response)
  part.mesh.position.z = approachValue(previousZ, targetDepth, response)
  const targetRotationX =
    part.restRotation.x - (stickVector?.y ?? 0) * STICK_MAX_TILT_RADIANS
  const targetRotationY =
    part.restRotation.y + (stickVector?.x ?? 0) * STICK_MAX_TILT_RADIANS
  part.mesh.rotation.x = approachValue(previousRotationX, targetRotationX, response)
  part.mesh.rotation.y = approachValue(previousRotationY, targetRotationY, response)

  const changed =
    part.highlight !== previousHighlight ||
    part.emphasis !== previousEmphasis ||
    part.mesh.position.x !== previousX ||
    part.mesh.position.y !== previousY ||
    part.mesh.position.z !== previousZ ||
    part.mesh.rotation.x !== previousRotationX ||
    part.mesh.rotation.y !== previousRotationY ||
    part.pressed !== pressed ||
    part.focused !== focused ||
    part.tone !== tone
  if (!changed) return false
  part.pressed = pressed
  part.focused = focused
  part.tone = tone

  if (part.material) {
    part.material.color.copy(part.baseColor).lerp(ACTIVE_BLUE, amount)
    part.material.emissive.copy(part.baseEmissive).lerp(ACTIVE_EMISSIVE, amount)
    part.material.emissiveIntensity =
      part.baseEmissiveIntensity + amount * (pressed ? 1.35 : 0.82)
    part.material.roughness = part.baseRoughness + (0.22 - part.baseRoughness) * amount
  }
  const emphasis = part.emphasis
  part.halo.material.color.copy(HALO_COLORS[tone])
  part.halo.material.opacity = emphasis
  // Interpolate toward the tone's rim width so a part does not jump thickness
  // as it fades in from nothing.
  const restScale = controllerPartHaloScale('none')
  part.halo.scale.setScalar(restScale + (controllerPartHaloScale(tone) - restScale) * emphasis)
  part.halo.visible = emphasis > 0.012
  part.symbolMaterial?.color.copy(SYMBOL_IDLE).lerp(SYMBOL_ACTIVE, amount)
  return true
}

function useDualSenseRenderer({
  selectedInput,
  activeValuesRef,
  subscribeActiveValues,
  availableInputs,
  mappedInputs = EMPTY_INPUT_SET,
  conflictInputs = EMPTY_INPUT_SET,
  onSelect,
  onDeselect,
  onHover
}: DualSenseSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const requestRenderRef = useRef<() => void>(() => undefined)
  const semanticButtonRefs = useRef(new Map<ControllerInputId, HTMLButtonElement>())
  const resetViewRef = useRef<() => void>(() => undefined)
  const semanticInstructionsId = useId()
  const [focusedInput, setFocusedInput] = useState<ControllerInputId | null>(null)
  const [viewChanged, setViewChanged] = useState(false)
  const [viewAnnouncement, setViewAnnouncement] = useState('')
  const availableInputSet = useMemo(() => new Set(availableInputs), [availableInputs])
  const latestRef = useRef({
    selectedInput,
    focusedInput,
    availableInputSet,
    mappedInputs,
    conflictInputs,
    onSelect,
    onDeselect,
    onHover
  })
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')

  useLayoutEffect(() => {
    latestRef.current = {
      selectedInput,
      focusedInput,
      availableInputSet,
      mappedInputs,
      conflictInputs,
      onSelect,
      onDeselect,
      onHover
    }
    // The loop parks itself when idle, so a re-render has to wake it.
    requestRenderRef.current()
  }, [
    availableInputSet,
    conflictInputs,
    focusedInput,
    mappedInputs,
    onDeselect,
    onHover,
    onSelect,
    selectedInput
  ])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new Scene()
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.93
    host.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.cursor = 'grab'

    const camera = new OrthographicCamera(-0.18, 0.18, 0.13, -0.13, 0.001, 10)
    camera.position.set(0, 0.034, 0.76)
    camera.lookAt(0, 0.008, 0)

    scene.add(new AmbientLight('#d7d5d0', 0.54))
    const key = new DirectionalLight('#fffdf8', 3.1)
    key.position.set(-0.33, 0.34, 0.56)
    scene.add(key)
    const fill = new DirectionalLight('#d4d8e0', 0.72)
    fill.position.set(0.36, 0.08, 0.42)
    scene.add(fill)
    const lowerRim = new DirectionalLight('#4b68c8', 0.28)
    lowerRim.position.set(0.16, -0.3, 0.24)
    scene.add(lowerRim)

    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const raycastMeshes: Mesh[] = []
    const parts = new Map<ControllerInputId, DualSensePartMesh[]>()
    const viewRoot = new Group()
    viewRoot.name = 'dualsense-view-root'
    viewRoot.rotation.order = 'YXZ'
    scene.add(viewRoot)
    let hoveredInput: ControllerInputId | null = null
    let pointerDownInput: ControllerInputId | null = null
    let pointerDownPosition: { x: number; y: number } | null = null
    let pointerDownView: ControllerSceneView = { ...defaultControllerSceneView }
    let targetView: ControllerSceneView = { ...defaultControllerSceneView }
    let renderedView: ControllerSceneView = { ...defaultControllerSceneView }
    let isRotating = false
    // Render-on-demand state. `dirty` means something external changed and the
    // frame must be re-evaluated; `settling` means an animation is still
    // converging. When both are false the loop does nothing and neither the
    // renderer nor the GPU process has any work to do.
    let dirty = true
    let settling = true
    let frameHandle: number | null = null
    let lastLatest: (typeof latestRef)['current'] | null = null
    let lastActiveValues: Partial<Record<ControllerInputId, number>> | null = null
    // The animation frame is parked when there is nothing to draw. An armed
    // rAF request alone keeps Chromium producing a compositor frame every
    // vsync — on a 120Hz panel that cost far more than the drawing itself.
    // `renderer.setAnimationLoop` cannot express this: its internal callback
    // re-arms unconditionally after invoking the loop, so stopping from inside
    // the callback is immediately undone.
    const scheduleFrame = (): void => {
      if (frameHandle === null) frameHandle = window.requestAnimationFrame(tick)
    }
    const requestRender = (): void => {
      dirty = true
      scheduleFrame()
    }
    requestRenderRef.current = requestRender
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = reducedMotionQuery.matches
    const handleReducedMotionChange = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches
      requestRender()
    }
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange)
    // The compositor keeps the last presented frame, but a reallocated drawing
    // buffer (resize, display change) or a restored window needs a repaint.
    const handleVisibilityChange = (): void => requestRender()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('resize', requestRender)
    let disposed = false
    resetViewRef.current = () => {
      targetView = { ...defaultControllerSceneView }
      if (reducedMotion) renderedView = { ...defaultControllerSceneView }
      setViewChanged(false)
      setViewAnnouncement('3D view reset to front.')
      requestRender()
    }

    const loader = new GLTFLoader()
    loader.load(
      new URL('models/DualSenseController.glb', window.location.href).href,
      (gltf) => {
        if (disposed) return
        const model = new Group()
        model.name = 'dualsense-model'
        model.add(gltf.scene)
        model.rotation.set(0, Math.PI, 0)
        model.position.y = 0.008
        model.updateMatrixWorld(true)
        model.traverse((object) => {
          if (!(object instanceof Mesh)) return
          object.material = Array.isArray(object.material)
            ? object.material.map(prepareControllerMaterial)
            : prepareControllerMaterial(object.material)
        })
        const split = splitDualSenseIntoParts(model)
        raycastMeshes.push(...split.raycastMeshes)
        for (const [input, records] of split.parts) parts.set(input, records)
        viewRoot.add(model)
        requestRender()
        setLoadState('ready')
      },
      undefined,
      () => {
        if (!disposed) setLoadState('error')
      }
    )

    let renderedWidth = 0
    let renderedHeight = 0
    const resize = (): void => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      if (width === renderedWidth && height === renderedHeight) return
      renderedWidth = width
      renderedHeight = height
      const aspect = width / height
      // Fit by whichever axis is tighter. Deriving the frustum from the height
      // alone crops the controller left and right as soon as the stage is
      // narrow, which is exactly what happens at the smallest window width.
      const frustumHeight = Math.max(FIT_HEIGHT, FIT_WIDTH / aspect)
      camera.left = (-frustumHeight * aspect) / 2
      camera.right = (frustumHeight * aspect) / 2
      camera.top = frustumHeight / 2
      camera.bottom = -frustumHeight / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      // The drawing buffer was just reallocated and cleared.
      requestRender()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()

    const raycastInput = (event: PointerEvent): ControllerInputId | null => {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(raycastMeshes, false)[0]
      return (hit?.object.userData.controllerInput as ControllerInputId | undefined) ?? null
    }

    const setHover = (input: ControllerInputId | null): void => {
      const exposed = input && latestRef.current.availableInputSet.has(input) ? input : null
      renderer.domElement.style.cursor = exposed ? 'pointer' : 'grab'
      if (exposed === hoveredInput) return
      hoveredInput = exposed
      requestRender()
      latestRef.current.onHover?.(exposed)
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (pointerDownPosition) {
        const deltaX = event.clientX - pointerDownPosition.x
        const deltaY = event.clientY - pointerDownPosition.y
        const stickDrag =
          pointerDownInput === 'leftStickClick' || pointerDownInput === 'rightStickClick'
        if (stickDrag && pointerDownInput) {
          setHover(resolveStickDrag(pointerDownInput, deltaX, deltaY))
          return
        }
        if (isRotating || Math.hypot(deltaX, deltaY) >= 6) {
          isRotating = true
          targetView = orbitControllerScene(pointerDownView, deltaX, deltaY)
          requestRender()
          setHover(null)
          renderer.domElement.style.cursor = 'grabbing'
          return
        }
      }
      setHover(raycastInput(event))
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      pointerDownInput = raycastInput(event)
      pointerDownPosition = { x: event.clientX, y: event.clientY }
      pointerDownView = { ...targetView }
      isRotating = false
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const handlePointerUp = (event: PointerEvent): void => {
      if (!pointerDownPosition) return
      const rotated = isRotating
      const pressedInput = pointerDownInput
      const downPosition = pointerDownPosition
      pointerDownInput = null
      pointerDownPosition = null
      isRotating = false
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
      if (rotated) {
        setViewChanged(controllerSceneViewChanged(targetView))
        setViewAnnouncement('3D view rotated.')
        setHover(raycastInput(event))
        return
      }
      if (!pressedInput) {
        latestRef.current.onDeselect()
        setHover(raycastInput(event))
        return
      }
      let resolved = pressedInput
      if (resolved === 'leftStickClick' || resolved === 'rightStickClick') {
        resolved = resolveStickDrag(
          resolved,
          event.clientX - downPosition.x,
          event.clientY - downPosition.y
        )
      } else if (raycastInput(event) !== pressedInput) {
        setHover(raycastInput(event))
        return
      }
      if (latestRef.current.availableInputSet.has(resolved)) {
        latestRef.current.onSelect(resolved)
      }
      setHover(raycastInput(event))
    }
    const handlePointerCancel = (event: PointerEvent): void => {
      pointerDownInput = null
      pointerDownPosition = null
      if (isRotating) setViewChanged(controllerSceneViewChanged(targetView))
      isRotating = false
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
      setHover(null)
    }
    const handlePointerLeave = (): void => {
      if (!pointerDownPosition) setHover(null)
    }
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      targetView = zoomControllerScene(targetView, event.deltaY)
      requestRender()
      setViewChanged(controllerSceneViewChanged(targetView))
      setViewAnnouncement('3D view zoom changed.')
    }
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)
    renderer.domElement.addEventListener('pointercancel', handlePointerCancel)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })

    /** Returns whether a frame was actually rendered. */
    const animate = (): boolean => {
      // Two cheap identity checks decide whether this frame needs any work at
      // all. `latestRef.current` is a fresh object on every React render of the
      // scene, and `activeValuesRef.current` is a fresh object on every
      // controller snapshot, so both are O(1) change signals.
      const current = latestRef.current
      if (current !== lastLatest) {
        lastLatest = current
        dirty = true
      }
      const activeValues = activeValuesRef.current
      if (activeValues !== lastActiveValues) {
        lastActiveValues = activeValues
        dirty = true
      }
      if (!dirty && !settling) return false
      dirty = false

      const selectedPhysical = current.selectedInput ? physicalInput(current.selectedInput) : null
      const focusedPhysical = current.focusedInput ? physicalInput(current.focusedInput) : null
      const leftStickVector = stickVectorFromActiveValues('left', activeValues)
      const rightStickVector = stickVectorFromActiveValues('right', activeValues)
      let changed = false
      for (const [input, records] of parts) {
        const activeValue = activeValueForPhysicalInput(input, activeValues)
        const active = controllerPartIsPressed(activeValue)
        const selected = selectedPhysical === input
        const focused = focusedPhysical === input
        const hovered = hoveredInput === input
        const state = {
          activeValue,
          selected,
          focused,
          hovered,
          mapped: current.mappedInputs.has(input),
          conflicting: current.conflictInputs.has(input)
        }
        const targetHighlight = controllerPartHighlight(state)
        const targetEmphasis = controllerPartEmphasis(state)
        const tone = controllerPartTone(state)
        const stickVector =
          input === 'leftStickClick'
            ? leftStickVector
            : input === 'rightStickClick'
              ? rightStickVector
              : undefined
        for (const record of records) {
          changed =
            animatePart(
              record,
              targetHighlight,
              targetEmphasis,
              tone,
              active,
              focused,
              reducedMotion,
              stickVector
            ) || changed
        }
      }
      const settled = settleControllerSceneView(
        renderedView,
        targetView,
        reducedMotion ? 1 : VIEW_RESPONSE
      )
      renderedView = settled.view
      changed = changed || settled.changed
      // Keep animating only while something is still converging. A frame that
      // was requested but produced no movement still renders once, so an
      // external change can never be dropped.
      settling = changed
      viewRoot.rotation.x = renderedView.pitch
      viewRoot.rotation.y = renderedView.yaw
      viewRoot.scale.setScalar(renderedView.zoom)
      renderer.render(scene, camera)
      return true
    }

    function tick(): void {
      frameHandle = null
      animate()
      // Only stay armed while something is still converging or pending.
      if (dirty || settling) scheduleFrame()
    }

    scheduleFrame()
    const unsubscribeActiveValues = subscribeActiveValues(requestRender)

    return () => {
      disposed = true
      resetViewRef.current = () => undefined
      requestRenderRef.current = () => undefined
      unsubscribeActiveValues()
      reducedMotionQuery.removeEventListener('change', handleReducedMotionChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('resize', requestRender)
      resizeObserver.disconnect()
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle)
      frameHandle = null
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('pointercancel', handlePointerCancel)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('wheel', handleWheel)
      disposeSceneResources(scene)
      renderer.dispose()
      // `dispose` releases three's own objects but leaves the WebGL context
      // itself alive, and a browser only grants a handful. Navigating between
      // views remounts this scene, so without an explicit context loss the
      // oldest contexts get reclaimed by the driver and an earlier canvas goes
      // black. Order matters: dispose first, then drop the context.
      renderer.forceContextLoss()
      host.replaceChildren()
    }
  }, [activeValuesRef, subscribeActiveValues])

  return {
    availableInputSet,
    focusedInput,
    hostRef,
    loadState,
    resetViewRef,
    semanticButtonRefs,
    semanticInstructionsId,
    setFocusedInput,
    viewAnnouncement,
    viewChanged
  }
}

function DualSenseSceneComponent(props: DualSenseSceneProps): React.JSX.Element {
  const { onSelect, selectedInput } = props
  const {
    availableInputSet,
    focusedInput,
    hostRef,
    loadState,
    resetViewRef,
    semanticButtonRefs,
    semanticInstructionsId,
    setFocusedInput,
    viewAnnouncement,
    viewChanged
  } = useDualSenseRenderer(props)
  /**
   * One canonical order drives the resting tab stop, arrow movement, Home, and
   * End. Controller capability payloads are sets in practice and are not
   * required to arrive in contract order, so using `availableInputs[0]` only for
   * the resting position made the first Arrow/Home press jump backwards.
   */
  const orderedAvailableInputs = useMemo(
    () => controllerInputIds.filter((input) => availableInputSet.has(input)),
    [availableInputSet]
  )
  const rovingInput =
    focusedInput && availableInputSet.has(focusedInput)
      ? focusedInput
      : selectedInput && availableInputSet.has(selectedInput)
        ? selectedInput
        : orderedAvailableInputs[0]

  return (
    <div className="controller-scene-shell" data-testid="controller-scene">
      <div ref={hostRef} className="controller-scene-canvas" />
      {loadState === 'loading' && (
        <div className="scene-loading" role="status">
          <span className="scene-loading-silhouette" />
          Loading DualSense geometry…
        </div>
      )}
      {loadState === 'error' && (
        <div className="scene-error" role="alert">
          The DualSense 3D model could not be loaded.
        </div>
      )}
      {loadState === 'ready' && (
        // The hint teaches the camera gesture once; after the view has moved it
        // is replaced by the only control that is then useful.
        <div className="scene-tools">
          {viewChanged ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Reset 3D controller view"
              onClick={() => resetViewRef.current()}
            >
              <RotateCcw size={13} aria-hidden="true" />
              Reset view
            </Button>
          ) : (
            <span className="scene-hint">Drag to rotate · Scroll to zoom</span>
          )}
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {viewAnnouncement}
      </span>
      <div
        className="sr-only controller-semantic-controls"
        role="group"
        aria-label="DualSense controls"
        aria-describedby={semanticInstructionsId}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocusedInput(null)
          }
        }}
      >
        <span id={semanticInstructionsId}>
          Use arrow keys to move between controller parts. Press Enter or Space to select.
          The visual 3D view can be rotated a full 360 degrees with a pointer and reset with
          the Reset view button.
        </span>
        {controllerInputIds.map((input) => (
          <button
            type="button"
            key={input}
            ref={(element) => {
              if (element) semanticButtonRefs.current.set(input, element)
              else semanticButtonRefs.current.delete(input)
            }}
            tabIndex={
              input === rovingInput ? 0 : -1
            }
            aria-pressed={selectedInput === input}
            disabled={!availableInputSet.has(input)}
            onFocus={() => setFocusedInput(input)}
            onKeyDown={(event) => {
              if (orderedAvailableInputs.length === 0) return
              const currentIndex = orderedAvailableInputs.indexOf(input)
              let nextIndex: number | null = null
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                nextIndex = (currentIndex + 1) % orderedAvailableInputs.length
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                nextIndex =
                  (currentIndex - 1 + orderedAvailableInputs.length) %
                  orderedAvailableInputs.length
              } else if (event.key === 'Home') {
                nextIndex = 0
              } else if (event.key === 'End') {
                nextIndex = orderedAvailableInputs.length - 1
              }
              if (nextIndex === null || !orderedAvailableInputs[nextIndex]) return
              event.preventDefault()
              semanticButtonRefs.current.get(orderedAvailableInputs[nextIndex])?.focus()
            }}
            onClick={() => onSelect(input)}
          >
            {inputDisplayNames[input]}
          </button>
        ))}
      </div>
    </div>
  )
}

export const DualSenseScene = memo(DualSenseSceneComponent)
