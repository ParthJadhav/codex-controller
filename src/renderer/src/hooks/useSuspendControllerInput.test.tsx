import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { controllerInputSuspension } from '../core/inputSuspension'
import { ShortcutRecorder } from '../components/MappingInspector'

/**
 * The recorder end of the suspension seam. The other end — dispatch actually
 * stopping — lives in useControllerApp.test.ts.
 */
describe('shortcut recording suspends controller input', () => {
  afterEach(() => expect(controllerInputSuspension.suspended).toBe(false))

  const renderRecorder = () =>
    render(<ShortcutRecorder onChange={vi.fn()} />)

  it('suspends while listening and resumes once a shortcut is recorded', () => {
    renderRecorder()
    const recorder = screen.getByRole('button')

    fireEvent.click(recorder)
    expect(controllerInputSuspension.suspended).toBe(true)

    fireEvent.keyDown(recorder, { key: 'a', code: 'KeyA' })
    expect(controllerInputSuspension.suspended).toBe(false)
  })

  it('resumes when recording is abandoned with Escape', () => {
    renderRecorder()
    const recorder = screen.getByRole('button')

    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: 'Escape', code: 'Escape' })

    expect(controllerInputSuspension.suspended).toBe(false)
  })

  /** A recorder torn down mid-recording must not leave the controller mute. */
  it('resumes when the recorder disappears while still listening', () => {
    const view = renderRecorder()

    fireEvent.click(screen.getByRole('button'))
    expect(controllerInputSuspension.suspended).toBe(true)
    view.unmount()

    expect(controllerInputSuspension.suspended).toBe(false)
  })
})
