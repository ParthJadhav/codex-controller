import { BrowserWindow, screen } from 'electron'

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[character] ?? character
  )

export class OverlayWindow {
  private window: BrowserWindow | null = null
  private hideTimer: NodeJS.Timeout | null = null

  show(title: string, detail: string, tone: string): void {
    this.hideTimer && clearTimeout(this.hideTimer)
    this.window?.destroy()

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const width = 340
    const height = 92
    this.window = new BrowserWindow({
      width,
      height,
      x: display.workArea.x + display.workArea.width - width - 24,
      y: display.workArea.y + 24,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.window.setIgnoreMouseEvents(true)
    const accent: Record<string, string> = {
      success: '#46d48a',
      warning: '#efaa35',
      failure: '#f0525d',
      layer: '#6587ff'
    }
    const html = `<!doctype html><meta charset="utf-8"><style>
      :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      body{margin:0;background:transparent}
      main{box-sizing:border-box;height:92px;padding:15px 17px;border-radius:13px;
        background:rgba(24,27,35,.96);color:#f6f7fb;border:1px solid rgba(207,218,255,.16)}
      .row{display:flex;gap:10px;align-items:center}.dot{width:8px;height:8px;border-radius:50%;
        background:${accent[tone] ?? '#6587ff'}}
      h1{font-size:14px;margin:0 0 5px;font-weight:650}p{font-size:12px;color:#b8bfcc;margin:0}
    </style><main role="status" aria-live="polite"><div class="row"><span class="dot"></span>
      <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div></div></main>`
    void this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    this.window.once('ready-to-show', () => this.window?.showInactive())
    this.hideTimer = setTimeout(() => {
      this.window?.close()
      this.window = null
    }, 2_400)
  }
}
