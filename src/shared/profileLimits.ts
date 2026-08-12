/**
 * The persistence limits enforced at every profile-library boundary.
 *
 * Main-process schemas are the final authority for disk and IPC data, while the
 * renderer imports the same values to stop users before they create something
 * that cannot be saved.
 */
export const profileLimits = {
  profiles: 24,
  profileName: 80,
  bindings: 256,
  actionTitle: 160,
  url: 2_048,
  commandId: 160,
  text: 10_000,
  sequenceSteps: 32,
  sequenceStepDelayMilliseconds: 5_000,
  shortcutKeyCode: 255,
  shortcutModifiers: 4,
  shortcutKeyDisplay: 40
} as const
