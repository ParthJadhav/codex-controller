import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  controllerInputIds,
  inputDisplayNames,
  pickableControllerInputIds,
  type ControllerInputId
} from '@shared/contracts'
import { DualSenseScene } from './DualSenseScene'

/**
 * The 3D half of this component needs a WebGL context jsdom cannot give it, and
 * none of what this file asserts is drawn by it. The keyboard layer under the
 * canvas is the subject: it is the only way to reach a controller part without
 * a pointer, and it is plain DOM.
 */
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeWebGLRenderer {
    readonly domElement = document.createElement('canvas')
    outputColorSpace = ''
    toneMapping = 0
    toneMappingExposure = 1
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer }
})

/** Never calls back, so the scene stays in its loading state and draws nothing. */
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(): void {}
  }
}))

const everyInput = [...controllerInputIds]
const face: ControllerInputId[] = ['buttonA', 'buttonB', 'buttonX', 'buttonY']

const show = (
  overrides: {
    selectedInput?: ControllerInputId | null
    availableInputs?: readonly ControllerInputId[]
    onSelect?: (input: ControllerInputId) => void
    onDeselect?: () => void
  } = {}
) => {
  const onSelect = overrides.onSelect ?? vi.fn()
  const onDeselect = overrides.onDeselect ?? vi.fn()
  const rendered = render(
    <DualSenseScene
      selectedInput={overrides.selectedInput ?? null}
      activeValuesRef={createRef<Partial<Record<ControllerInputId, number>>>() as never}
      subscribeActiveValues={() => () => undefined}
      availableInputs={overrides.availableInputs ?? everyInput}
      onSelect={onSelect}
      onDeselect={onDeselect}
    />
  )
  return { ...rendered, onSelect, onDeselect }
}

const controlFor = (input: ControllerInputId): HTMLButtonElement =>
  screen.getByRole('button', { name: inputDisplayNames[input] }) as HTMLButtonElement

/** The single control the group hands the tab stop to. */
const tabStop = (): HTMLButtonElement | undefined =>
  (screen.getAllByRole('button') as HTMLButtonElement[]).find(
    (button) => button.tabIndex === 0 && button.textContent !== null
  )

describe('the DualSense scene keyboard layer', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    )
    // jsdom ships neither of these, and the scene setup reads both before it
    // gets anywhere near the DOM this file is about.
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('offers every controller part as a named control in one labelled group', () => {
    show()

    const group = screen.getByRole('group', { name: 'DualSense controls' })
    expect(group).toBeTruthy()
    for (const input of controllerInputIds) {
      expect(controlFor(input)).toBeTruthy()
    }
  })

  it('describes the group with instructions naming the arrow keys', () => {
    show()

    const group = screen.getByRole('group', { name: 'DualSense controls' })
    const described = document.getElementById(group.getAttribute('aria-describedby')!)
    expect(described?.textContent).toMatch(/arrow keys/i)
    expect(described?.textContent).toMatch(/Enter or Space/)
  })

  it('disables the parts this controller does not report', () => {
    show({ availableInputs: face })

    for (const input of face) expect(controlFor(input).disabled).toBe(false)
    expect(controlFor('touchpad').disabled).toBe(true)
    expect(controlFor('leftTrigger').disabled).toBe(true)
  })

  it('never makes the legacy Share alias authorable in the disconnected set', () => {
    show({ availableInputs: pickableControllerInputIds })
    expect(controlFor('share').disabled).toBe(true)
  })

  describe('the roving tab stop', () => {
    it('leaves exactly one control tabbable', () => {
      show({ availableInputs: face })

      const tabbable = (screen.getAllByRole('button') as HTMLButtonElement[]).filter(
        (button) => button.tabIndex === 0
      )
      expect(tabbable).toHaveLength(1)
    })

    it('parks on the first available control when nothing is selected', () => {
      show({ availableInputs: face, selectedInput: null })

      expect(tabStop()).toBe(controlFor('buttonA'))
    })

    it('uses contract order for both its resting position and Home', () => {
      show({ availableInputs: ['dpadUp', 'buttonA'], selectedInput: null })

      expect(tabStop()).toBe(controlFor('buttonA'))

      const start = controlFor('dpadUp')
      start.focus()
      fireEvent.keyDown(start, { key: 'Home' })
      expect(document.activeElement).toBe(controlFor('buttonA'))
    })

    it('parks on the selected control', () => {
      show({ availableInputs: face, selectedInput: 'buttonX' })

      expect(tabStop()).toBe(controlFor('buttonX'))
    })

    it('falls back to the first available control when the selection is not on this controller', () => {
      show({ availableInputs: face, selectedInput: 'touchpad' })

      expect(tabStop()).toBe(controlFor('buttonA'))
    })

    it('follows focus, so tabbing back returns to where the user was', () => {
      show({ availableInputs: face, selectedInput: 'buttonA' })

      fireEvent.focus(controlFor('buttonY'))

      expect(tabStop()).toBe(controlFor('buttonY'))
    })

    it('moves the tab stop when the focused control stops being available', () => {
      const rendered = show({ availableInputs: ['buttonA', 'buttonB'] })
      fireEvent.focus(controlFor('buttonB'))

      rendered.rerender(
        <DualSenseScene
          selectedInput={null}
          activeValuesRef={
            createRef<Partial<Record<ControllerInputId, number>>>() as never
          }
          subscribeActiveValues={() => () => undefined}
          availableInputs={['buttonA']}
          onSelect={rendered.onSelect}
          onDeselect={rendered.onDeselect}
        />
      )

      expect(tabStop()).toBe(controlFor('buttonA'))
    })

    it('goes back to the selected control once focus leaves the group', () => {
      show({ availableInputs: face, selectedInput: 'buttonA' })
      fireEvent.focus(controlFor('buttonY'))

      fireEvent.blur(controlFor('buttonY'), { relatedTarget: document.body })

      expect(tabStop()).toBe(controlFor('buttonA'))
    })

    it('keeps the tab stop where it is while focus moves within the group', () => {
      show({ availableInputs: face, selectedInput: 'buttonA' })
      fireEvent.focus(controlFor('buttonY'))

      fireEvent.blur(controlFor('buttonY'), { relatedTarget: controlFor('buttonB') })

      expect(tabStop()).toBe(controlFor('buttonY'))
    })
  })

  describe('arrow-key navigation', () => {
    it.each(['ArrowRight', 'ArrowDown'])('moves to the next control on %s', (key) => {
      show({ availableInputs: face })
      const start = controlFor('buttonA')
      start.focus()

      fireEvent.keyDown(start, { key })

      expect(document.activeElement).toBe(controlFor('buttonB'))
    })

    it.each(['ArrowLeft', 'ArrowUp'])('moves to the previous control on %s', (key) => {
      show({ availableInputs: face })
      const start = controlFor('buttonB')
      start.focus()

      fireEvent.keyDown(start, { key })

      expect(document.activeElement).toBe(controlFor('buttonA'))
    })

    it('wraps around both ends', () => {
      show({ availableInputs: face })

      const last = controlFor('buttonY')
      last.focus()
      fireEvent.keyDown(last, { key: 'ArrowRight' })
      expect(document.activeElement).toBe(controlFor('buttonA'))

      fireEvent.keyDown(controlFor('buttonA'), { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(controlFor('buttonY'))
    })

    /** Stepping onto a control this controller cannot report is a dead end. */
    it('skips the parts the controller does not report', () => {
      show({ availableInputs: ['buttonA', 'touchpad'] })
      const start = controlFor('buttonA')
      start.focus()

      fireEvent.keyDown(start, { key: 'ArrowRight' })

      expect(document.activeElement).toBe(controlFor('touchpad'))
    })

    it('jumps to the ends on Home and End', () => {
      show({ availableInputs: face })
      const start = controlFor('buttonB')
      start.focus()

      fireEvent.keyDown(start, { key: 'End' })
      expect(document.activeElement).toBe(controlFor('buttonY'))

      fireEvent.keyDown(controlFor('buttonY'), { key: 'Home' })
      expect(document.activeElement).toBe(controlFor('buttonA'))
    })

    it('claims the arrow keys so the page does not scroll instead', () => {
      show({ availableInputs: face })
      const start = controlFor('buttonA')
      start.focus()

      const moved = fireEvent.keyDown(start, { key: 'ArrowRight' })
      expect(moved).toBe(false)
    })

    it('leaves every other key to the browser', () => {
      show({ availableInputs: face })
      const start = controlFor('buttonA')
      start.focus()

      expect(fireEvent.keyDown(start, { key: 'Tab' })).toBe(true)
      expect(fireEvent.keyDown(start, { key: 'a' })).toBe(true)
      expect(document.activeElement).toBe(start)
    })

    it('does nothing when the controller reports no parts at all', () => {
      show({ availableInputs: [] })
      const start = controlFor('buttonA')

      expect(fireEvent.keyDown(start, { key: 'ArrowRight' })).toBe(true)
    })
  })

  describe('selecting a part', () => {
    it('reports the part the user activated', () => {
      const { onSelect } = show({ availableInputs: face })

      fireEvent.click(controlFor('buttonX'))

      expect(onSelect).toHaveBeenCalledWith('buttonX')
    })

    it('marks only the selected part as pressed', () => {
      show({ availableInputs: face, selectedInput: 'buttonB' })

      expect(controlFor('buttonB').getAttribute('aria-pressed')).toBe('true')
      expect(controlFor('buttonA').getAttribute('aria-pressed')).toBe('false')
    })
  })
})
