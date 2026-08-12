import { describe, expect, it } from 'vitest'
import { profileLimits } from '@shared/profileLimits'
import { duplicateProfileName } from './profileNames'

describe('duplicate profile names', () => {
  it('appends Copy without exceeding the persistence limit', () => {
    const duplicated = duplicateProfileName('A'.repeat(profileLimits.profileName))
    expect(duplicated).toHaveLength(profileLimits.profileName)
    expect(duplicated).toMatch(/ Copy$/)
  })

  it('keeps short names intact', () => {
    expect(duplicateProfileName('Work')).toBe('Work Copy')
  })
})
