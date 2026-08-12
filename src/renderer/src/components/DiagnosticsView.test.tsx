import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { stickTelemetry, type RotationTraceEntry } from '../core/rotationDiagnostics'
import { DiagnosticsView } from './DiagnosticsView'

const telemetry = (
  values: Parameters<typeof stickTelemetry>[1],
  banked = 0,
  rejected = 0,
  everTracked = false
) => ({ ...stickTelemetry('right', values, banked, rejected), everTracked })

const diagnosticsModel = (update: Partial<ControllerAppModel> = {}): ControllerAppModel =>
  ({
    controller: {
      connected: true,
      id: 'dualsense',
      name: 'DualSense Wireless Controller',
      productCategory: 'DualSense',
      transport: 'Bluetooth',
      batteryLevel: 0.6,
      supportsLight: true,
      supportsHaptics: true,
      touchpadPointerEnabled: true,
      touchpadPointerStatus: 'ready',
      capabilities: [],
      activeValues: {}
    },
    controllerEvents: [],
    rotationTrace: [] as RotationTraceEntry[],
    stickDiagnostics: { left: telemetry({}), right: telemetry({}) },
    system: null,
    refreshSystem: vi.fn(),
    ...update
  }) as unknown as ControllerAppModel

const rotationPanel = () =>
  screen.getByRole('region', { name: 'Stick rotation' }) ??
  screen.getByLabelText('Stick rotation')

describe('Diagnostics stick rotation', () => {
  it('renders without a controller having moved', () => {
    render(<DiagnosticsView model={diagnosticsModel()} />)
    expect(screen.getByText('Stick rotation')).toBeTruthy()
    expect(screen.getByText('No rotation steps yet.')).toBeTruthy()
  })

  it('says no samples have arrived when the sticks are centred', () => {
    render(<DiagnosticsView model={diagnosticsModel()} />)
    expect(screen.getAllByText(/No stick samples yet/).length).toBe(2)
  })

  /**
   * The distinction the whole panel exists for: a stick that publishes samples
   * but never completes a step must not read the same as a stick that produced
   * one.
   */
  it('separates a tracked-but-stepless stick from one that has stepped', () => {
    render(
      <DiagnosticsView
        model={diagnosticsModel({
          stickDiagnostics: {
            left: telemetry({}),
            right: telemetry({ rightStickRight: 1 }, Math.PI / 4, 0, true)
          }
        })}
      />
    )
    expect(screen.getByText(/keep turning one full circle/i)).toBeTruthy()
  })

  it('reports a discarded-sample cadence problem distinctly', () => {
    render(
      <DiagnosticsView
        model={diagnosticsModel({
          stickDiagnostics: {
            left: telemetry({}),
            right: telemetry({ rightStickRight: 1 }, 0, 6, true)
          }
        })}
      />
    )
    expect(screen.getByText(/sample cadence issue/i)).toBeTruthy()
  })

  it('lists rotation steps with their direction', () => {
    const trace: RotationTraceEntry[] = [
      {
        id: 'step-1',
        input: 'rightStickClick',
        step: 'clockwise',
        timestamp: 1,
        magnitude: 0.9,
        angleDegrees: 45
      },
      {
        id: 'step-2',
        input: 'leftStickClick',
        step: 'counterclockwise',
        timestamp: 2,
        magnitude: 0.8,
        angleDegrees: -20
      }
    ]
    render(
      <DiagnosticsView
        model={diagnosticsModel({
          rotationTrace: trace,
          stickDiagnostics: {
            left: telemetry({ rightStickRight: 1 }, 0, 0, true),
            right: telemetry({ rightStickRight: 1 }, 0, 0, true)
          }
        })}
      />
    )
    const steps = screen.getByRole('table', { name: 'Stick rotation steps' })
    expect(within(steps).getByText('Clockwise')).toBeTruthy()
    expect(within(steps).getByText('Counterclockwise')).toBeTruthy()
    expect(screen.getAllByText(/Detection works/).length).toBe(2)
  })

  it('counts each stick’s steps separately', () => {
    render(
      <DiagnosticsView
        model={diagnosticsModel({
          rotationTrace: [
            {
              id: 'a',
              input: 'rightStickClick',
              step: 'clockwise',
              timestamp: 1,
              magnitude: 1,
              angleDegrees: 0
            },
            {
              id: 'b',
              input: 'rightStickClick',
              step: 'clockwise',
              timestamp: 2,
              magnitude: 1,
              angleDegrees: 0
            }
          ]
        })}
      />
    )
    // R3 has both steps; L3 has none.
    expect(screen.getByText('2 CW · 0 CCW')).toBeTruthy()
    expect(screen.getByText('0 CW · 0 CCW')).toBeTruthy()
  })
})

describe('Diagnostics page', () => {
  it('still renders the existing access and input panels', () => {
    render(<DiagnosticsView model={diagnosticsModel()} />)
    expect(screen.getByText('System access')).toBeTruthy()
    expect(screen.getByText('Input monitor')).toBeTruthy()
    expect(rotationPanel()).toBeTruthy()
  })

  /**
   * Regression: several rows can be unmet at once, and four buttons all named
   * "Open Settings" gave a screen reader no way to tell which pane each opens.
   */
  it('gives every Open Settings button the row it belongs to', () => {
    render(<DiagnosticsView model={diagnosticsModel()} />)
    const buttons = screen.getAllByRole('button', { name: /^Open Settings for / })

    expect(buttons.length).toBeGreaterThan(1)
    const names = buttons.map((button) => button.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('Open Settings for Accessibility')
    expect(names).toContain('Open Settings for Microphone')
    // The visible label stays short.
    for (const button of buttons) expect(button.textContent).toBe('Open Settings')
  })
})
