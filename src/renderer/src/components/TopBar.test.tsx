import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { TooltipProvider } from './ui/tooltip'
import { TopBar } from './TopBar'

const topBarModel = (update: Partial<ControllerAppModel> = {}): ControllerAppModel =>
  ({
    section: 'controller',
    controller: {
      connected: true,
      id: 'dualsense',
      name: 'DualSense Wireless Controller',
      productCategory: 'DualSense',
      transport: 'Bluetooth',
      batteryLevel: 0.75,
      supportsLight: true,
      supportsHaptics: true,
      touchpadPointerEnabled: true,
      touchpadPointerStatus: 'ready',
      capabilities: [],
      activeValues: {}
    },
    library: {
      schemaVersion: 1,
      activeProfileId: 'profile-1',
      profiles: [{ id: 'profile-1', name: 'Codex' }]
    },
    activeProfile: { id: 'profile-1', name: 'Codex' },
    isEnabled: true,
    setSection: vi.fn(),
    setIsEnabled: vi.fn(),
    selectProfile: vi.fn(),
    ...update
  }) as unknown as ControllerAppModel

const renderTopBar = (model: ControllerAppModel): ReturnType<typeof render> =>
  render(
    <TooltipProvider>
      <TopBar model={model} />
    </TooltipProvider>
  )

describe('Command bar', () => {
  it('keeps the same three command slots across volatile controller states', () => {
    const connected = topBarModel()
    const { container, rerender } = renderTopBar(connected)

    const slots = (): Array<string | undefined> =>
      Array.from(
        container.querySelectorAll<HTMLElement>('.profile-picker, .controller-health, .dispatch-toggle')
      ).map((slot) =>
        ['profile-picker', 'controller-health', 'dispatch-toggle'].find((name) =>
          slot.classList.contains(name)
        )
      )

    const before = slots()
    expect(before).toEqual(['profile-picker', 'controller-health', 'dispatch-toggle'])
    expect(screen.getByRole('button', { name: /DualSense: Bluetooth . 75%/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Active profile: Codex/ })).toBeTruthy()

    rerender(
      <TooltipProvider>
        <TopBar
          model={topBarModel({
            controller: {
              ...connected.controller,
              connected: false,
              transport: 'Unknown',
              batteryLevel: null
            },
            library: {
              ...connected.library,
              profiles: [
                {
                  ...connected.library.profiles[0],
                  name: 'A very long delivery profile name that must truncate'
                }
              ]
            },
            activeProfile: {
              ...connected.activeProfile,
              name: 'A very long delivery profile name that must truncate'
            },
            isEnabled: false
          } as unknown as Partial<ControllerAppModel>)}
        />
      </TooltipProvider>
    )

    expect(slots()).toEqual(before)
    expect(screen.getByRole('button', { name: /Controller: Not connected/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /A very long delivery profile/ })).toBeTruthy()
  })

  it('labels dispatch with its state instead of the verb that changes it', () => {
    const running = topBarModel()
    const { rerender } = renderTopBar(running)

    const toggle = screen.getByRole('button', { name: 'Controller dispatch: Dispatching' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.textContent).toContain('Dispatching')

    fireEvent.click(toggle)
    expect(running.setIsEnabled).toHaveBeenCalledWith(false)

    rerender(
      <TooltipProvider>
        <TopBar model={topBarModel({ isEnabled: false } as Partial<ControllerAppModel>)} />
      </TooltipProvider>
    )
    const paused = screen.getByRole('button', { name: 'Controller dispatch: Paused' })
    expect(paused.getAttribute('aria-pressed')).toBe('false')
    expect(paused.textContent).toContain('Paused')
  })

  it('keeps a direct path from controller health to diagnostics', () => {
    const model = topBarModel()
    renderTopBar(model)

    fireEvent.click(screen.getByRole('button', { name: /Open diagnostics/ }))
    expect(model.setSection).toHaveBeenCalledWith('diagnostics')
  })
})
