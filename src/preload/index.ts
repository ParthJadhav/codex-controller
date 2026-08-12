import { contextBridge, ipcRenderer } from 'electron'
import {
  profileFlushRequestChannel,
  profileFlushResultChannel
} from '../shared/contracts'
import type {
  ActionRequest,
  CodexControllerApi,
  MappingProfile,
  NativeBridgeEvent,
  ProfileFlushResult,
  ProfileLibrary
} from '../shared/contracts'

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const api: CodexControllerApi = {
  profiles: {
    load: () => ipcRenderer.invoke('profiles:load'),
    save: (library: ProfileLibrary) => ipcRenderer.invoke('profiles:save', library),
    import: (library: ProfileLibrary) => ipcRenderer.invoke('profiles:import', library),
    export: (profile: MappingProfile) => ipcRenderer.invoke('profiles:export', profile),
    onFlushRequested: (listener: () => Promise<void>) => {
      const handler = (_event: Electron.IpcRendererEvent, requestId: unknown): void => {
        if (typeof requestId !== 'string') return
        void listener().then(
          () => {
            const result: ProfileFlushResult = { requestId, success: true }
            ipcRenderer.send(profileFlushResultChannel, result)
          },
          (error: unknown) => {
            const result: ProfileFlushResult = {
              requestId,
              success: false,
              message: errorMessage(error)
            }
            ipcRenderer.send(profileFlushResultChannel, result)
          }
        )
      }
      ipcRenderer.on(profileFlushRequestChannel, handler)
      return () => ipcRenderer.removeListener(profileFlushRequestChannel, handler)
    }
  },
  actions: {
    execute: (request: ActionRequest) => ipcRenderer.invoke('actions:execute', request),
    showOverlay: (title: string, detail: string, tone: string) =>
      ipcRenderer.invoke('overlay:show', { title, detail, tone })
  },
  codex: {
    keymapStatus: (managed) => ipcRenderer.invoke('codex:keymap-status', managed),
    applyKeymap: (managed) => ipcRenderer.invoke('codex:apply-keymap', managed)
  },
  system: {
    snapshot: () => ipcRenderer.invoke('system:snapshot'),
    refresh: () => ipcRenderer.invoke('system:refresh'),
    openSettings: (pane) => ipcRenderer.invoke('system:open-settings', pane),
    requestMediaAccess: () => ipcRenderer.invoke('system:request-media-access')
  },
  native: {
    send: (command: string, payload?: unknown) =>
      ipcRenderer.invoke('native:send', { command, payload }),
    subscribe: (listener: (event: NativeBridgeEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: NativeBridgeEvent): void => {
        listener(value)
      }
      ipcRenderer.on('native:event', handler)
      return () => ipcRenderer.removeListener('native:event', handler)
    }
  }
}

contextBridge.exposeInMainWorld('controllerControls', api)
