import { join } from 'node:path'
import { app } from 'electron'
import log from 'electron-log/main'
import { redactLogValue } from './logRedaction'
import { rotateLogFiles } from './logRotation'

export const logFileName = 'main.log'
export const logMaxBytes = 5 * 1024 * 1024
export const logArchiveCount = 3

let configured = false

/** Configures local diagnostics once, before the first BrowserWindow exists. */
export const configureLogging = (): typeof log => {
  if (configured) return log
  configured = true

  app.setAppLogsPath()
  log.transports.file.fileName = logFileName
  log.transports.file.level = 'debug'
  log.transports.file.maxSize = logMaxBytes
  log.transports.file.writeOptions = {
    ...log.transports.file.writeOptions,
    mode: 0o600
  }
  log.transports.file.resolvePathFn = () => join(app.getPath('logs'), logFileName)
  log.transports.file.archiveLogFn = (file) => {
    try {
      rotateLogFiles(file.path, logArchiveCount)
    } catch {
      // Do not feed a rotation failure back into the full file transport: that
      // can recursively ask the same over-limit file to rotate again.
      process.stderr.write('Codex Controller could not rotate its local diagnostic log.\n')
    }
  }
  log.transports.console.level = app.isPackaged ? 'info' : 'debug'
  log.scope.labelPadding = false
  log.hooks.push((message) => ({
    ...message,
    data: message.data.map((value) => redactLogValue(value))
  }))

  // This installs electron-log's sandbox-compatible renderer bridge. Renderer
  // messages still pass through the redaction hook before reaching disk.
  log.initialize()
  log.errorHandler.startCatching({ showDialog: false })
  log.eventLogger.startLogging({
    events: {
      app: {
        'child-process-gone': true,
        'render-process-gone': true
      },
      webContents: {
        'did-fail-load': true,
        'did-fail-provisional-load': true,
        'preload-error': true,
        unresponsive: true
      }
    }
  })

  Object.assign(console, log.functions)
  log.info('[startup] Logging initialized', {
    path: log.transports.file.getFile().path,
    maxBytesPerFile: logMaxBytes,
    archiveCount: logArchiveCount
  })
  return log
}

export const logger = log
