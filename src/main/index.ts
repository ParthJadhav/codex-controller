import { join } from 'node:path'
import { release as operatingSystemRelease } from 'node:os'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  shell,
  systemPreferences
} from 'electron'
import {
  profileFlushRequestChannel,
  profileFlushResultChannel
} from '../shared/contracts'
import type {
  ActionResult,
  CodexKeymapStatusSnapshot,
  CodexKeymapWriteSnapshot,
  ControllerSnapshot,
  MappingProfile,
  NativeBridgeEvent,
  ProfileLibrary,
  SystemSnapshot
} from '../shared/contracts'
import { ActionExecutor } from './actionExecutor'
import { AppShutdownCoordinator, ProfileFlushRequester } from './appShutdown'
import { applyCodexKeymap, codexKeymapPath, codexKeymapStatus } from './codexKeymap'
import {
  parseActionRequest,
  parseManagedBindings,
  parseNativeSend,
  parseOverlayRequest,
  parseSystemSettingsPane
} from './ipcRequests'
import { configureLogging } from './logger'
import { MainWindowHandle } from './mainWindowHandle'
import { NativeBridge } from './nativeBridge'
import { OverlayWindow } from './overlayWindow'
import { ProfileRepository } from './profileRepository'

const sonyVendorId = 0x054c
// The app outlives its window on macOS, so every later use goes through the
// handle, which drops the reference on `closed`.
const mainWindow = new MainWindowHandle()

// Device-access switches must be registered before Electron becomes ready.
app.commandLine.appendSwitch('disable-hid-blocklist')
const userDataPath = join(app.getPath('appData'), 'codex-controller')
app.setName('Codex Controller')
app.setPath('userData', userDataPath)
const log = configureLogging().scope('main')
log.info('[startup] Main process started', {
  version: app.getVersion(),
  packaged: app.isPackaged,
  platform: process.platform,
  operatingSystemRelease: operatingSystemRelease(),
  architecture: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome
})
const hasSingleInstanceLock = app.requestSingleInstanceLock()

const repository = new ProfileRepository()
const nativeBridge = new NativeBridge()
const actions = new ActionExecutor(nativeBridge)
const overlay = new OverlayWindow()
const profileFlush = new ProfileFlushRequester(profileFlushRequestChannel)
const shutdown = new AppShutdownCoordinator({
  releaseHeldShortcuts: () => actions.prepareForShutdown(2_000),
  // No live window is normal on macOS after the user closes it. There is then
  // no renderer-owned draft to flush; any earlier pagehide write is covered by
  // the repository drain below.
  flushProfiles: () => {
    const window = mainWindow.live
    if (!window || window.webContents.isDestroyed()) return Promise.resolve()
    return profileFlush.request(window.webContents)
  },
  drainProfileWrites: () => repository.drain(),
  stopBridge: () => nativeBridge.stop(),
  quitApp: () => app.quit(),
  reportError: (message) => nativeBridge.reportError(message, 'Shutdown cleanup failed.')
})

const createWindow = (): void => {
  log.info('[window] Creating main window')
  const window = new BrowserWindow({
    width: 1586,
    height: 992,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#11131a',
    title: 'Codex Controller',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.attach(window)
  window.once('ready-to-show', () => {
    log.info('[window] Main window ready')
    mainWindow.live?.show()
  })
  window.on('closed', () => {
    log.info('[window] Main window closed')
    mainWindow.release()
  })
  window.webContents.on('did-finish-load', () => log.info('[window] Renderer loaded'))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      log.info('[navigation] Opening an HTTPS link externally')
      void shell.openExternal(url)
    } else {
      log.warn('[navigation] Refused a non-HTTPS window request')
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl ? !url.startsWith(devUrl) : !url.startsWith('file:')) {
      log.warn('[navigation] Refused renderer navigation')
      event.preventDefault()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const configureDeviceAccess = (): void => {
  log.info('[devices] Configuring local media and Sony HID access')
  const ses = session.defaultSession
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const localOrigin =
      requestingOrigin.startsWith('file://') || requestingOrigin.startsWith('http://localhost')
    return localOrigin && ['media', 'hid'].includes(permission)
  })
  ses.setDevicePermissionHandler((details) => {
    return details.deviceType === 'hid' && details.device.vendorId === sonyVendorId
  })
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    const device = details.deviceList.find((candidate) => candidate.vendorId === sonyVendorId)
    log.info('[devices] HID selection requested', {
      allowedDeviceAvailable: Boolean(device),
      candidateCount: details.deviceList.length
    })
    callback(device?.deviceId)
  })
}

const profileSummary = (library: ProfileLibrary): { profiles: number; bindings: number } => ({
  profiles: library.profiles.length,
  bindings: library.profiles.reduce((total, profile) => total + profile.bindings.length, 0)
})

const errorMetadata = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) return { type: typeof error }
  const code = (error as Error & { code?: unknown }).code
  return {
    name: error.name,
    ...(code === undefined ? {} : { code }),
    // Preserve the diagnostic call sites without persisting an exception
    // message that might have interpolated a user-authored value.
    stack: error.stack?.split('\n').slice(1).join('\n')
  }
}

const loggedOperation = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  log.debug(`[operation] ${name} started`)
  try {
    const result = await operation()
    log.debug(`[operation] ${name} completed`)
    return result
  } catch (error) {
    log.error(`[operation] ${name} failed`, errorMetadata(error))
    throw error
  }
}

const systemSnapshot = (): SystemSnapshot => {
  const native = nativeBridge.systemSnapshot
  return {
    platform: process.platform,
    appVersion: app.getVersion(),
    nativeBridgeAvailable: nativeBridge.isAvailable,
    codexRunning: native.codexRunning ?? false,
    accessibilityTrusted:
      native.accessibilityTrusted ?? systemPreferences.isTrustedAccessibilityClient(false),
    microphonePermission:
      native.microphonePermission ?? systemPreferences.getMediaAccessStatus('microphone'),
    inputMonitoringTrusted: native.inputMonitoringTrusted ?? false,
    audio: native.audio ?? {
      defaultInputName: 'Unavailable',
      defaultOutputName: 'Unavailable'
    }
  }
}

const registerIpc = (): void => {
  log.info('[ipc] Registering renderer handlers')
  ipcMain.on(profileFlushResultChannel, (event, value: unknown) => {
    profileFlush.acceptResult(event.sender, value)
  })
  ipcMain.handle('profiles:load', () =>
    loggedOperation('profiles.load', async () => {
      const library = await repository.load()
      log.info('[profiles] Library loaded', profileSummary(library))
      return library
    })
  )
  ipcMain.handle('profiles:save', (_event, library: ProfileLibrary) =>
    loggedOperation('profiles.save', async () => {
      const saved = await repository.save(library)
      log.info('[profiles] Library saved', profileSummary(saved))
      return saved
    })
  )
  ipcMain.handle('profiles:import', (_event, library: ProfileLibrary) =>
    loggedOperation('profiles.import', async () => {
      const imported = await repository.import(library)
      log.info(
        '[profiles] Profile import finished',
        imported ? profileSummary(imported) : { cancelled: true }
      )
      return imported
    })
  )
  ipcMain.handle('profiles:export', (_event, profile: MappingProfile) =>
    loggedOperation('profiles.export', async () => {
      const exported = await repository.export(profile)
      log.info('[profiles] Profile export finished', { exported })
      return exported
    })
  )
  // Every handler below validates its argument before acting on it: an IPC
  // handler is callable with anything the renderer process can be made to send.
  // See `ipcRequests.ts` for what each one accepts and why.
  ipcMain.handle('actions:execute', async (_event, value: unknown): Promise<ActionResult> => {
    const request = parseActionRequest(value)
    if (!request.ok) {
      log.warn('[actions] Refused an invalid action request')
      return { status: 'failure', message: request.message }
    }
    const metadata = {
      type: request.value.action.type,
      focusPolicy: request.value.focusPolicy,
      safety: request.value.safety,
      gesture: request.value.gesture ?? 'none'
    }
    log.debug('[actions] Execution requested', metadata)
    try {
      const result = await actions.execute(request.value)
      if (result.status === 'failure') {
        log.warn('[actions] Execution finished', { ...metadata, status: result.status })
      } else {
        log.debug('[actions] Execution finished', { ...metadata, status: result.status })
      }
      return result
    } catch (error) {
      log.error('[actions] Execution threw', metadata, errorMetadata(error))
      throw error
    }
  })
  ipcMain.handle('overlay:show', (_event, value: unknown): void => {
    const request = parseOverlayRequest(value)
    // A malformed overlay is reported rather than shown: it is a bug in the
    // caller, and the action it was announcing has already run.
    if (!request.ok) {
      nativeBridge.reportError(request.message, 'A malformed overlay request was refused.')
      return
    }
    overlay.show(request.value.title, request.value.detail, request.value.tone)
  })
  // The managed set comes from the renderer because it depends on the active
  // profile's live mappings, which the main process has no view of.
  ipcMain.handle(
    'codex:keymap-status',
    async (_event, value: unknown): Promise<CodexKeymapStatusSnapshot> => {
      const managed = parseManagedBindings(value)
      if (!managed.ok) {
        log.warn('[keymap] Refused an invalid status request')
        return {
          path: codexKeymapPath(),
          readable: false,
          entries: [],
          conflicts: [],
          satisfied: false
        }
      }
      return loggedOperation('keymap.status', async () => {
        const status = await codexKeymapStatus(managed.value)
        log.info('[keymap] Status checked', {
          managedBindings: managed.value.length,
          conflicts: status.conflicts.length,
          satisfied: status.satisfied
        })
        return status
      })
    }
  )
  ipcMain.handle(
    'codex:apply-keymap',
    async (_event, value: unknown): Promise<CodexKeymapWriteSnapshot> => {
      const managed = parseManagedBindings(value)
      if (!managed.ok) {
        log.warn('[keymap] Refused an invalid write request')
        return {
          status: 'failed',
          message: managed.message,
          path: codexKeymapPath(),
          entries: []
        }
      }
      return loggedOperation('keymap.apply', async () => {
        const result = await applyCodexKeymap(managed.value)
        log.info('[keymap] Write finished', {
          managedBindings: managed.value.length,
          status: result.status,
          entries: result.entries.length
        })
        return result
      })
    }
  )
  ipcMain.handle('system:snapshot', systemSnapshot)
  ipcMain.handle('system:refresh', async (): Promise<SystemSnapshot> => {
    await nativeBridge.request('system.refresh')
    return systemSnapshot()
  })
  ipcMain.handle('system:request-media-access', async () => {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    log.info('[permissions] Microphone access request finished', { granted })
    return granted
  })
  ipcMain.handle('system:open-settings', (_event, value: unknown): void => {
    const requested = parseSystemSettingsPane(value)
    if (!requested.ok) {
      nativeBridge.reportError(requested.message, 'An invalid System Settings request was refused.')
      return
    }
    log.info('[settings] Opening a System Settings pane', { pane: requested.value })
    if (requested.value === 'sound') {
      void shell.openExternal('x-apple.systempreferences:com.apple.Sound-Settings.extension')
      return
    }
    const anchors = {
      accessibility: 'Privacy_Accessibility',
      inputMonitoring: 'Privacy_ListenEvent',
      microphone: 'Privacy_Microphone'
    }
    void shell.openExternal(
      `x-apple.systempreferences:com.apple.preference.security?${anchors[requested.value]}`
    )
  })
  ipcMain.handle('native:send', (_event, value: unknown): boolean => {
    const request = parseNativeSend(value)
    if (!request.ok) {
      nativeBridge.reportError(request.message, 'An invalid native bridge command was refused.')
      return false
    }
    return nativeBridge.send(request.value.command, request.value.payload)
  })
}

if (!hasSingleInstanceLock) {
  log.warn('[startup] Another instance already holds the application lock')
  app.quit()
} else {
  // `activate` covers the closed-window case; this only raises a live window.
  app.on('second-instance', () => {
    log.info('[lifecycle] Second launch requested; revealing the existing window')
    mainWindow.reveal()
  })

  app.whenReady().then(async () => {
    log.info('[lifecycle] Electron is ready')
    nativeTheme.themeSource = 'dark'
    Menu.setApplicationMenu(null)
    configureDeviceAccess()
    registerIpc()
    createWindow()

    let lastControllerConnected: boolean | undefined
    let lastPermissionState = ''
    nativeBridge.on('event', (event: NativeBridgeEvent) => {
      if (event.type === 'controller') {
        const snapshot = event.payload as ControllerSnapshot
        if (snapshot.connected !== lastControllerConnected) {
          lastControllerConnected = snapshot.connected
          log.info('[controller] Connection state changed', {
            connected: snapshot.connected,
            transport: snapshot.connected ? snapshot.transport : 'none',
            capabilityCount: snapshot.connected ? snapshot.capabilities.length : 0,
            supportsHaptics: snapshot.connected && snapshot.supportsHaptics,
            supportsLight: snapshot.connected && snapshot.supportsLight
          })
        }
      } else if (event.type === 'permission') {
        const snapshot = event.payload as SystemSnapshot
        const state = JSON.stringify({
          accessibility: snapshot.accessibilityTrusted,
          inputMonitoring: snapshot.inputMonitoringTrusted,
          microphone: snapshot.microphonePermission,
          codexRunning: snapshot.codexRunning
        })
        if (state !== lastPermissionState) {
          lastPermissionState = state
          log.info('[system] Permission or Codex state changed', JSON.parse(state))
        }
      }
      mainWindow.forwardNativeEvent(event)
    })
    await nativeBridge.start()
    log.info('[native bridge] Initial launch finished', { available: nativeBridge.isAvailable })

    app.on('activate', () => {
      log.info('[lifecycle] Application activated')
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  log.info('[lifecycle] All windows closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  log.info('[lifecycle] Quit requested')
  shutdown.handleBeforeQuit(event)
})

app.on('quit', (_event, exitCode) => {
  log.info('[lifecycle] Application quit', { exitCode })
})
