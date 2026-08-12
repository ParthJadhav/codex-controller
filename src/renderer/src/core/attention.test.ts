import type { SystemSnapshot } from '@shared/contracts'
import { describe, expect, it } from 'vitest'
import { diagnosticsAttention } from './attention'

/** A snapshot with nothing wrong; each test breaks exactly one thing. */
const healthy = (overrides: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
  platform: 'darwin',
  appVersion: '1.0.0',
  nativeBridgeAvailable: true,
  codexRunning: true,
  accessibilityTrusted: true,
  microphonePermission: 'authorized',
  inputMonitoringTrusted: true,
  audio: { defaultInputName: 'Built-in', defaultOutputName: 'Built-in' },
  ...overrides
})

describe('diagnosticsAttention', () => {
  it('says nothing before the first snapshot arrives', () => {
    expect(diagnosticsAttention(null)).toEqual({ blocking: false, summary: null })
  })

  it('says nothing when every check passes', () => {
    expect(diagnosticsAttention(healthy())).toEqual({ blocking: false, summary: null })
  })

  it('blocks on a missing native bridge', () => {
    expect(diagnosticsAttention(healthy({ nativeBridgeAvailable: false }))).toEqual({
      blocking: true,
      summary: 'Native bridge is not running'
    })
  })

  it('blocks when the snapshot omits nativeBridgeAvailable entirely', () => {
    const { nativeBridgeAvailable: _unused, ...withoutBridgeFlag } = healthy()
    expect(diagnosticsAttention(withoutBridgeFlag)).toEqual({
      blocking: true,
      summary: 'Native bridge is not running'
    })
  })

  it('blocks on missing Accessibility trust', () => {
    expect(diagnosticsAttention(healthy({ accessibilityTrusted: false }))).toEqual({
      blocking: true,
      summary: 'Accessibility access required'
    })
  })

  it.each(['denied', 'notDetermined', 'restricted', 'something-unexpected', ''])(
    'blocks on microphone permission %s',
    (microphonePermission) => {
      expect(diagnosticsAttention(healthy({ microphonePermission }))).toEqual({
        blocking: true,
        summary: 'Microphone access required'
      })
    }
  )

  it.each(['authorized', 'granted'])('accepts microphone permission %s', (microphonePermission) => {
    expect(diagnosticsAttention(healthy({ microphonePermission })).summary).toBeNull()
  })

  it('reports unconfirmed Input Monitoring without blocking', () => {
    expect(diagnosticsAttention(healthy({ inputMonitoringTrusted: false }))).toEqual({
      blocking: false,
      summary: 'Input Monitoring not confirmed'
    })
  })

  it('reports the most disabling failure first', () => {
    const everythingBroken = healthy({
      nativeBridgeAvailable: false,
      accessibilityTrusted: false,
      microphonePermission: 'denied',
      inputMonitoringTrusted: false
    })
    expect(diagnosticsAttention(everythingBroken).summary).toBe('Native bridge is not running')

    expect(
      diagnosticsAttention({ ...everythingBroken, nativeBridgeAvailable: true }).summary
    ).toBe('Accessibility access required')

    expect(
      diagnosticsAttention({
        ...everythingBroken,
        nativeBridgeAvailable: true,
        accessibilityTrusted: true
      }).summary
    ).toBe('Microphone access required')

    expect(
      diagnosticsAttention({
        ...everythingBroken,
        nativeBridgeAvailable: true,
        accessibilityTrusted: true,
        microphonePermission: 'authorized'
      }).summary
    ).toBe('Input Monitoring not confirmed')
  })
})
