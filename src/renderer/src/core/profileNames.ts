import { profileLimits } from '@shared/profileLimits'

export const duplicateProfileName = (name: string): string => {
  const suffix = ' Copy'
  return `${name.slice(0, profileLimits.profileName - suffix.length).trimEnd()}${suffix}`
}
