import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { AutosaveStatus } from './AutosaveStatus'

type AutosaveState = ControllerAppModel['autosaveState']

const show = (
  autosaveState: AutosaveState,
  autosaveMessage = 'All changes saved',
  compact = false
): HTMLElement => {
  const model = { autosaveState, autosaveMessage } as unknown as ControllerAppModel
  render(<AutosaveStatus model={model} compact={compact} />)
  return screen.getByRole('status')
}

/**
 * The app has no Save button, so this is the whole account the user gets of
 * whether an edit reached the disk. "Saved" is the resting state and earns no
 * colour; anything else has to say what it is.
 */
describe('AutosaveStatus', () => {
  it('reads as saved at rest, without a tone', () => {
    const status = show('saved')

    expect(status.textContent).toBe('Saved')
    expect(status.dataset.state).toBe('saved')
    expect(status.dataset.tone).toBe('quiet')
  })

  it.each([
    ['pending', 'Saving soon'],
    ['saving', 'Saving…']
  ] as const)('reads %s as %s and marks itself busy', (autosaveState, label) => {
    const status = show(autosaveState, 'Changes will save automatically')

    expect(status.textContent).toBe(label)
    expect(status.dataset.tone).toBe('busy')
  })

  it.each(['invalid', 'error'] as const)('warns on %s', (autosaveState) => {
    const status = show(autosaveState, 'Cross needs a complete HTTP or HTTPS URL.')

    expect(status.dataset.tone).toBe('warning')
    expect(status.dataset.state).toBe(autosaveState)
  })

  it('spells the problem out when there is room for it', () => {
    const status = show('invalid', 'Cross needs a complete HTTP or HTTPS URL.')

    expect(status.textContent).toBe('Cross needs a complete HTTP or HTTPS URL.')
  })

  it('shortens the problem to two words in the compact placement', () => {
    const status = show('invalid', 'Cross needs a complete HTTP or HTTPS URL.', true)

    expect(status.textContent).toBe('Not saved')
    // The full sentence is still reachable on hover.
    expect(status.getAttribute('title')).toBe('Cross needs a complete HTTP or HTTPS URL.')
  })

  it('does not shorten the resting or busy states in the compact placement', () => {
    expect(show('saved', 'All changes saved', true).textContent).toBe('Saved')
    cleanup()
    expect(show('saving', 'Saving changes…', true).textContent).toBe('Saving…')
  })

  it('announces changes politely rather than interrupting', () => {
    const status = show('error', 'Autosave failed')

    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('title')).toBe('Autosave failed')
  })
})
