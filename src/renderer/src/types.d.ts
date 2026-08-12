import type { CodexControllerApi } from '../../shared/contracts'

declare global {
  interface Window {
    controllerControls: CodexControllerApi
  }
}

export {}
