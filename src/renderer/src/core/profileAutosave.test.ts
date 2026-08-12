import { describe, expect, it } from 'vitest'
import { createDefaultProfile } from '@shared/defaultProfile'
import type { ProfileLibrary } from '@shared/contracts'
import { profileLimits } from '@shared/profileLimits'
import { profileAutosaveIssue } from './profileAutosave'

const library = (): ProfileLibrary => {
  const profile = createDefaultProfile()
  return { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] }
}

describe('profile autosave validation', () => {
  it('accepts a complete default library', () => {
    expect(profileAutosaveIssue(library())).toBeNull()
  })

  it('waits for transient text and URL edits to become complete', () => {
    const value = library()
    value.profiles[0].name = ''
    expect(profileAutosaveIssue(value)).toMatch(/profile name/i)

    value.profiles[0].name = 'Work'
    const binding = value.profiles[0].bindings[0]!
    binding.action = { type: 'deepLink', title: 'Open Codex', deepLinkURL: 'codex://' }
    expect(profileAutosaveIssue(value)).toMatch(/complete codex/i)

    binding.action.deepLinkURL = 'codex://settings'
    expect(profileAutosaveIssue(value)).toBeNull()
  })

  it('blocks conflicts and incomplete nested sequence steps', () => {
    const value = library()
    value.profiles[0].bindings.push({
      ...structuredClone(value.profiles[0].bindings[0]),
      id: crypto.randomUUID()
    })
    expect(profileAutosaveIssue(value)).toMatch(/conflicts/i)

    value.profiles[0].bindings.pop()
    value.profiles[0].bindings[0].action = {
      type: 'sequence',
      title: 'Sequence',
      sequenceSteps: [
        {
          id: crypto.randomUUID(),
          delayMilliseconds: 0,
          action: { type: 'openWebURL', title: 'Open site', deepLinkURL: 'https://' },
          focusPolicy: 'neverFocus',
          safety: 'normal'
        }
      ]
    }
    expect(profileAutosaveIssue(value)).toMatch(/complete HTTP/i)
  })

  it('still refuses a shortcut action with no shortcut at all', () => {
    const value = library()
    value.profiles[0].bindings[0].action = { type: 'keyboardShortcut', title: 'Nothing yet' }
    expect(profileAutosaveIssue(value)).toMatch(/recorded keyboard shortcut/i)
  })

  /**
   * Regression: recording Space stored `keyDisplay: ' '`, which the schema accepted
   * and this validator rejected — autosave wedged in "invalid" with the whole
   * library unsaveable. The recorder now writes "Space", and a library saved
   * before that fix has to remain saveable rather than stay stuck.
   */
  it('accepts a shortcut whose label is blank but whose key code is real', () => {
    const value = library()
    value.profiles[0].bindings[0].action = {
      type: 'keyboardShortcut',
      title: 'Play',
      shortcut: { keyCode: 49, keyDisplay: ' ', modifiers: [] }
    }
    expect(profileAutosaveIssue(value)).toBeNull()
  })

  it('rejects action and gesture combinations the runtime cannot activate', () => {
    const value = library()
    const binding = value.profiles[0]!.bindings[0]!
    binding.action = { type: 'layerShift', title: 'Hold Review', targetLayer: 'review' }
    binding.gesture = 'tap'
    expect(profileAutosaveIssue(value)).toMatch(/Start holding/)

    binding.action = {
      type: 'holdShortcut',
      title: 'Held key',
      shortcut: { keyCode: 2, keyDisplay: 'D', modifiers: ['control'] }
    }
    expect(profileAutosaveIssue(value)).toMatch(/holding gesture/)
  })

  it('enforces shared persistence limits before save', () => {
    const value = library()
    const profile = value.profiles[0]!
    profile.name = 'P'.repeat(profileLimits.profileName + 1)
    expect(profileAutosaveIssue(value)).toMatch(/profile names/i)

    profile.name = 'Work'
    profile.bindings = Array.from({ length: profileLimits.bindings + 1 }, (_, index) => ({
      ...structuredClone(profile.bindings[0]!),
      id: `binding-${index}`
    }))
    expect(profileAutosaveIssue(value)).toMatch(/at most 256 mappings/i)

    profile.bindings = [structuredClone(createDefaultProfile().bindings[0]!)]
    profile.bindings[0]!.action.title = 'A'.repeat(profileLimits.actionTitle + 1)
    expect(profileAutosaveIssue(value)).toMatch(/160 characters or fewer/i)
  })
})
