import { describe, expect, it } from 'vitest'
import { permissionPresentation } from './permissionStatus'

describe('permissionPresentation', () => {
  it.each(['authorized', 'granted'])('treats %s as allowed', (status) => {
    expect(permissionPresentation(status)).toMatchObject({
      label: 'Allowed',
      allowed: true,
      requestable: false
    })
  })

  it.each(['notDetermined', 'not-determined'])('makes %s requestable', (status) => {
    expect(permissionPresentation(status)).toMatchObject({
      label: 'Not requested',
      allowed: false,
      requestable: true,
      recoverInSettings: false
    })
  })

  it.each(['denied', 'restricted', 'unexpected', undefined])(
    'routes %s to System Settings recovery',
    (status) => {
      expect(permissionPresentation(status).recoverInSettings).toBe(true)
    }
  )
})
