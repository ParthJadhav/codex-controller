import { describe, expect, it } from 'vitest'
import { controllerLightStatuses } from '@shared/contracts'
import { dominantLightStatus, lightColors } from './lightStatus'

describe('controller light priority', () => {
  const base = {
    hasRunningActions: false,
    needsAttention: false,
    isCodexRunning: false
  }

  it('gives transient outcomes the highest priority', () => {
    expect(
      dominantLightStatus({
        ...base,
        hasRunningActions: true,
        needsAttention: true,
        transient: 'failure'
      })
    ).toBe('failure')
  })

  it('prioritizes actions, attention, Codex, then idle', () => {
    expect(dominantLightStatus({ ...base, hasRunningActions: true, needsAttention: true })).toBe(
      'actions'
    )
    expect(dominantLightStatus({ ...base, needsAttention: true, isCodexRunning: true })).toBe(
      'attention'
    )
    expect(dominantLightStatus({ ...base, isCodexRunning: true })).toBe('codex')
    expect(dominantLightStatus(base)).toBe('idle')
  })

  /**
   * The purple `voice` status had no producer: its input was a listening state
   * Codex Controller does not have, so it was a colour the light could never show
   * and a row in the docs that could never be observed.
   */
  it('carries no status the decision cannot produce', () => {
    const reachable = new Set<string>([
      'idle',
      'codex',
      'actions',
      'attention',
      'success',
      'failure'
    ])
    expect(new Set(controllerLightStatuses)).toEqual(reachable)
    expect(new Set(Object.keys(lightColors))).toEqual(reachable)
    expect(controllerLightStatuses).not.toContain('voice')
  })
})
