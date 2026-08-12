import type { MappedAction, ProfileLibrary } from '@shared/contracts'
import { profileLimits } from '@shared/profileLimits'
import { mappingConflicts } from './mappingResolver'

const actionIssue = (action: MappedAction, label: string): string | null => {
  if (!action.title.trim()) return `${label} needs a name.`
  if (action.title.length > profileLimits.actionTitle) {
    return `${label} must be ${profileLimits.actionTitle} characters or fewer.`
  }
  if ((action.deepLinkURL?.length ?? 0) > profileLimits.url) {
    return `${label} has a URL longer than ${profileLimits.url} characters.`
  }
  if ((action.text?.length ?? 0) > profileLimits.text) {
    return `${label} has more than ${profileLimits.text} characters of text.`
  }

  switch (action.type) {
    case 'none':
    case 'primaryClick':
      return null
    case 'deepLink':
      return action.deepLinkURL?.trim().toLowerCase().startsWith('codex://') &&
        action.deepLinkURL.trim().length > 'codex://'.length
        ? null
        : `${label} needs a complete codex:// URL.`
    case 'openWebURL': {
      try {
        const url = new URL(action.deepLinkURL?.trim() ?? '')
        return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
          ? null
          : `${label} needs a complete HTTP or HTTPS URL.`
      } catch {
        return `${label} needs a complete HTTP or HTTPS URL.`
      }
    }
    case 'keyboardShortcut':
    case 'holdShortcut':
      /**
       * What makes a shortcut recorded is the key code — that is what the bridge
       * posts. The label is only how it reads back, so a mapping missing one
       * still works and must not block saving the rest of the library.
       *
       * Requiring a non-blank label used to disagree with the schema, which
       * accepts any one-character string: recording Space stored `keyDisplay:
       * ' '`, which trimmed to empty and wedged autosave in "invalid" with no
       * way out. The recorder now names such keys ("Space"), and this stays
       * lenient so a profile saved before that fix is still saveable.
       */
      return Number.isFinite(action.shortcut?.keyCode)
        ? null
        : `${label} needs a recorded keyboard shortcut.`
    case 'textInsertion':
      return action.text?.trim() ? null : `${label} needs text to insert.`
    case 'layerShift':
      return action.targetLayer ? null : `${label} needs a target layer.`
    case 'sequence': {
      const steps = action.sequenceSteps ?? []
      if (steps.length === 0) return `${label} needs at least one step.`
      if (steps.length > profileLimits.sequenceSteps) {
        return `${label} can contain at most ${profileLimits.sequenceSteps} steps.`
      }
      for (const [index, step] of steps.entries()) {
        const issue = actionIssue(step.action, `${label}, step ${index + 1}`)
        if (issue) return issue
        if (
          !Number.isInteger(step.delayMilliseconds) ||
          step.delayMilliseconds < 0 ||
          step.delayMilliseconds > profileLimits.sequenceStepDelayMilliseconds
        ) {
          return `${label}, step ${index + 1} needs a delay from 0 to ${profileLimits.sequenceStepDelayMilliseconds} ms.`
        }
      }
      return null
    }
  }
}

export const profileAutosaveIssue = (library: ProfileLibrary): string | null => {
  if (library.profiles.length === 0) return 'At least one profile is required.'
  if (library.profiles.length > profileLimits.profiles) {
    return `A library can contain at most ${profileLimits.profiles} profiles.`
  }
  if (!library.profiles.some((profile) => profile.id === library.activeProfileId)) {
    return 'The active profile no longer exists.'
  }

  for (const profile of library.profiles) {
    if (!profile.name.trim()) return 'Finish entering the profile name to autosave.'
    if (profile.name.length > profileLimits.profileName) {
      return `Profile names must be ${profileLimits.profileName} characters or fewer.`
    }
    if (profile.bindings.length > profileLimits.bindings) {
      return `${profile.name} can contain at most ${profileLimits.bindings} mappings.`
    }
    if (mappingConflicts(profile).length > 0) {
      return `Resolve mapping conflicts in ${profile.name} to autosave.`
    }
    if (profile.axisReleaseThreshold >= profile.axisEnterThreshold) {
      return `Stick release must remain below activation in ${profile.name}.`
    }
    if (profile.triggerReleaseThreshold >= profile.triggerEnterThreshold) {
      return `Trigger release must remain below activation in ${profile.name}.`
    }
    for (const binding of profile.bindings) {
      if (binding.action.type === 'layerShift' && binding.gesture !== 'holdBegan') {
        return `${binding.action.title || 'The layer shift'} needs the Start holding gesture.`
      }
      if (
        binding.action.type === 'holdShortcut' &&
        binding.gesture !== 'holdBegan' &&
        binding.gesture !== 'holdEnded'
      ) {
        return `${binding.action.title || 'The held shortcut'} needs a holding gesture.`
      }
      if (binding.gesture === 'chord' && !binding.secondaryInput) {
        return `${binding.action.title || 'The chord mapping'} needs a second control.`
      }
      const issue = actionIssue(binding.action, binding.action.title || 'The mapping')
      if (issue) return issue
    }
  }

  return null
}
