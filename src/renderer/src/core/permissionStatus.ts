export interface PermissionPresentation {
  label: 'Allowed' | 'Not requested' | 'Denied' | 'Restricted' | 'Unknown'
  allowed: boolean
  requestable: boolean
  recoverInSettings: boolean
}

export const permissionPresentation = (status?: string): PermissionPresentation => {
  switch (status?.toLowerCase().replaceAll('-', '')) {
    case 'authorized':
    case 'granted':
      return {
        label: 'Allowed',
        allowed: true,
        requestable: false,
        recoverInSettings: false
      }
    case 'notdetermined':
      return {
        label: 'Not requested',
        allowed: false,
        requestable: true,
        recoverInSettings: false
      }
    case 'denied':
      return {
        label: 'Denied',
        allowed: false,
        requestable: false,
        recoverInSettings: true
      }
    case 'restricted':
      return {
        label: 'Restricted',
        allowed: false,
        requestable: false,
        recoverInSettings: true
      }
    default:
      return {
        label: 'Unknown',
        allowed: false,
        requestable: false,
        recoverInSettings: true
      }
  }
}
