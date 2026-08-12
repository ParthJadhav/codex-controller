import { join } from 'node:path'
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
  reportError: (message) => nativeBridge.reportError(message)
})

const createWindow = (): void => {
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
  window.once('ready-to-show', () => mainWindow.live?.show())
  window.on('closed', () => mainWindow.release())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl ? !url.startsWith(devUrl) : !url.startsWith('file:')) {
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
    callback(details.deviceList.find((device) => device.vendorId === sonyVendorId)?.deviceId)
  })
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
  ipcMain.on(profileFlushResultChannel, (event, value: unknown) => {
    profileFlush.acceptResult(event.sender, value)
  })
  ipcMain.handle('profiles:load', () => repository.load())
  ipcMain.handle('profiles:save', (_event, library: ProfileLibrary) => repository.save(library))
  ipcMain.handle('profiles:import', (_event, library: ProfileLibrary) =>
    repository.import(library)
  )
  ipcMain.handle('profiles:export', (_event, profile: MappingProfile) =>
    repository.export(profile)
  )
  // Every handler below validates its argument before acting on it: an IPC
  // handler is callable with anything the renderer process can be made to send.
  // See `ipcRequests.ts` for what each one accepts and why.
  ipcMain.handle('actions:execute', (_event, value: unknown): Promise<ActionResult> => {
    const request = parseActionRequest(value)
    if (!request.ok) return Promise.resolve({ status: 'failure', message: request.message })
    return actions.execute(request.value)
  })
  ipcMain.handle('overlay:show', (_event, value: unknown): void => {
    const request = parseOverlayRequest(value)
    // A malformed overlay is reported rather than shown: it is a bug in the
    // caller, and the action it was announcing has already run.
    if (!request.ok) {
      nativeBridge.reportError(request.message)
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
        return {
          path: codexKeymapPath(),
          readable: false,
          entries: [],
          conflicts: [],
          satisfied: false
        }
      }
      return codexKeymapStatus(managed.value)
    }
  )
  ipcMain.handle(
    'codex:apply-keymap',
    async (_event, value: unknown): Promise<CodexKeymapWriteSnapshot> => {
      const managed = parseManagedBindings(value)
      if (!managed.ok) {
        return {
          status: 'failed',
          message: managed.message,
          path: codexKeymapPath(),
          entries: []
        }
      }
      return applyCodexKeymap(managed.value)
    }
  )
  ipcMain.handle('system:snapshot', systemSnapshot)
  ipcMain.handle('system:refresh', async (): Promise<SystemSnapshot> => {
    await nativeBridge.request('system.refresh')
    return systemSnapshot()
  })
  ipcMain.handle('system:request-media-access', () =>
    systemPreferences.askForMediaAccess('microphone')
  )
  ipcMain.handle('system:open-settings', (_event, value: unknown): void => {
    const requested = parseSystemSettingsPane(value)
    if (!requested.ok) {
      nativeBridge.reportError(requested.message)
      return
    }
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
      nativeBridge.reportError(request.message)
      return false
    }
    return nativeBridge.send(request.value.command, request.value.payload)
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  // `activate` covers the closed-window case; this only raises a live window.
  app.on('second-instance', () => {
    mainWindow.reveal()
  })

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark'
    Menu.setApplicationMenu(null)
    configureDeviceAccess()
    registerIpc()
    createWindow()

    nativeBridge.on('event', (event: NativeBridgeEvent) => {
      mainWindow.forwardNativeEvent(event)
    })
    await nativeBridge.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  shutdown.handleBeforeQuit(event)
})
