import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { TooltipProvider } from './ui/tooltip'
import { Sidebar } from './Sidebar'

const model = (update: Partial<ControllerAppModel> = {}): ControllerAppModel =>
  ({
    section: 'controller',
    setSection: vi.fn(),
    conflicts: [],
    system: null,
    lightStatus: 'idle',
    codexKeymap: null,
    isApplyingCodexKeymap: false,
    applyCodexKeymap: vi.fn(),
    ...update
  }) as unknown as ControllerAppModel

const renderSidebar = (value: ControllerAppModel): HTMLElement => {
  render(
    <TooltipProvider>
      <Sidebar model={value} />
    </TooltipProvider>
  )
  return screen.getByRole('complementary', { name: 'Primary navigation' })
}

describe('Sidebar navigation', () => {
  it('exposes every section with a shortcut matching its position', () => {
    const value = model()
    const sidebar = renderSidebar(value)

    const shortcutFor = (name: string): string | null =>
      within(sidebar).getByRole('button', { name }).getAttribute('aria-keyshortcuts')

    expect(shortcutFor('Controller')).toBe('Meta+1')
    expect(shortcutFor('Mappings')).toBe('Meta+2')
    // Diagnostics used to be reachable only from an overflow menu.
    expect(shortcutFor('Diagnostics')).toBe('Meta+3')
    expect(shortcutFor('Settings')).toBe('Meta+4')

    const settings = within(sidebar).getByRole('button', { name: 'Settings' })
    expect(settings.closest('.sidebar-footer')).not.toBeNull()
    fireEvent.click(settings)
    expect(value.setSection).toHaveBeenCalledWith('settings')
  })

  it('reports conflicts and blocked permissions without opening those sections', () => {
    const sidebar = renderSidebar(
      model({
        conflicts: [
          [{ id: 'a' }, { id: 'b' }],
          [{ id: 'c' }, { id: 'd' }]
        ],
        system: {
          nativeBridgeAvailable: true,
          accessibilityTrusted: false,
          microphonePermission: 'authorized',
          speechPermission: 'authorized',
          inputMonitoringTrusted: true
        }
      } as unknown as Partial<ControllerAppModel>)
    )

    const mappings = within(sidebar).getByRole('button', { name: 'Mappings, 2 conflicts' })
    expect(within(mappings).getByText('2')).toBeTruthy()

    const diagnostics = within(sidebar).getByRole('button', {
      name: 'Diagnostics, needs attention'
    })
    expect(diagnostics.querySelector('.nav-item-dot')).not.toBeNull()
  })

  it('names the controller light state rather than only colouring a dot', () => {
    const sidebar = renderSidebar(model({ lightStatus: 'actions' } as Partial<ControllerAppModel>))
    expect(
      within(sidebar).getByRole('status', { name: 'Controller light: Dispatching' })
    ).toBeTruthy()
  })
})

describe('Codex shortcut alert', () => {
  const keymapEntry = (state: 'set' | 'alreadySet' | 'conflict', commandId = 'a') => ({
    commandId,
    title: 'Increase reasoning effort',
    accelerator: 'Ctrl+Shift+.',
    state,
    previous: null
  })

  const keymap = (update: Record<string, unknown> = {}) => ({
    path: '/tmp/keybindings.json',
    readable: true,
    entries: [],
    conflicts: [],
    unwritable: [],
    satisfied: true,
    ...update
  })

  /**
   * The whole point of moving this out of Settings: it must cost nothing when
   * there is nothing to do, and be visible from anywhere when there is.
   */
  it('is absent while the keymap is still being read', () => {
    const sidebar = renderSidebar(model())
    expect(within(sidebar).queryByText(/Codex shortcut/)).toBeNull()
  })

  it('is absent once every shortcut is bound', () => {
    const sidebar = renderSidebar(
      model({ codexKeymap: keymap({ entries: [keymapEntry('alreadySet')] }) })
    )
    expect(within(sidebar).queryByText(/Codex shortcut/)).toBeNull()
  })

  it('is absent when the profile needs nothing bound', () => {
    const sidebar = renderSidebar(model({ codexKeymap: keymap() }))
    expect(within(sidebar).queryByText(/Codex shortcut/)).toBeNull()
  })

  it('appears with a count when shortcuts are unset', () => {
    const sidebar = renderSidebar(
      model({
        codexKeymap: keymap({
          entries: [keymapEntry('set', 'a'), keymapEntry('set', 'b')],
          satisfied: false
        })
      })
    )
    expect(within(sidebar).getByText('Set 2 Codex shortcuts')).toBeTruthy()
  })

  it('writes the shortcuts in place rather than navigating away', () => {
    const applyCodexKeymap = vi.fn()
    const setSection = vi.fn()
    const sidebar = renderSidebar(
      model({
        applyCodexKeymap,
        setSection,
        codexKeymap: keymap({ entries: [keymapEntry('set')], satisfied: false })
      })
    )
    fireEvent.click(within(sidebar).getByText('Set 1 Codex shortcut'))
    expect(applyCodexKeymap).toHaveBeenCalledOnce()
    expect(setSection).not.toHaveBeenCalled()
  })

  /**
   * A conflict cannot be resolved by writing, so the alert must hand the user to
   * the explanation instead of firing a write that would refuse.
   */
  it('sends a conflict to Settings instead of attempting a write', () => {
    const applyCodexKeymap = vi.fn()
    const setSection = vi.fn()
    const sidebar = renderSidebar(
      model({
        applyCodexKeymap,
        setSection,
        codexKeymap: keymap({
          satisfied: false,
          conflicts: [{ ...keymapEntry('conflict'), heldBy: 'toggleTerminal' }]
        })
      })
    )
    fireEvent.click(within(sidebar).getByText('1 shortcut needs attention'))
    expect(setSection).toHaveBeenCalledWith('settings')
    expect(applyCodexKeymap).not.toHaveBeenCalled()
  })

  it('shows progress and cannot be pressed twice while writing', () => {
    const sidebar = renderSidebar(
      model({
        isApplyingCodexKeymap: true,
        codexKeymap: keymap({ entries: [keymapEntry('set')], satisfied: false })
      })
    )
    const button = within(sidebar).getByText('Updating Codex…').closest('button')
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
