import type { ControllerLightStatus } from '@shared/contracts'

export const lightColors: Record<ControllerLightStatus, string> = {
  idle: '#61708a',
  codex: '#4f76ff',
  actions: '#21c7e8',
  attention: '#f4a72f',
  success: '#45d487',
  failure: '#f0525d'
}

/**
 * The priority order is unchanged apart from the removal of voice listening,
 * which sat between the transient result and action dispatch and could never
 * be reached: Codex Controller has no listening state of its own to report.
 */
export const dominantLightStatus = (state: {
  hasRunningActions: boolean
  needsAttention: boolean
  isCodexRunning: boolean
  transient?: 'success' | 'failure'
}): ControllerLightStatus => {
  if (state.transient) return state.transient
  if (state.hasRunningActions) return 'actions'
  if (state.needsAttention) return 'attention'
  if (state.isCodexRunning) return 'codex'
  return 'idle'
}
