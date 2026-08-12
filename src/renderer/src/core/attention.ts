import type { SystemSnapshot } from '@shared/contracts'
import { permissionPresentation } from './permissionStatus'

export interface SectionAttention {
  /** Something is wrong and the user has to act. */
  blocking: boolean
  /** One short phrase naming the most urgent problem, or null when healthy. */
  summary: string | null
}

/**
 * Diagnostics is the section that owns permission and bridge failures, so the
 * navigation entry has to be able to say "look here" without the user opening
 * it first. Ordered by how completely each failure disables the app.
 */
export const diagnosticsAttention = (system: SystemSnapshot | null): SectionAttention => {
  if (!system) return { blocking: false, summary: null }
  if (!system.nativeBridgeAvailable) {
    return { blocking: true, summary: 'Native bridge is not running' }
  }
  if (!system.accessibilityTrusted) {
    return { blocking: true, summary: 'Accessibility access required' }
  }
  // Microphone access is still worth reporting: the DualSense microphone
  // verification uses it. Speech Recognition is gone with dictation.
  const microphone = permissionPresentation(system.microphonePermission)
  if (!microphone.allowed) return { blocking: true, summary: 'Microphone access required' }
  if (!system.inputMonitoringTrusted) {
    return { blocking: false, summary: 'Input Monitoring not confirmed' }
  }
  return { blocking: false, summary: null }
}
