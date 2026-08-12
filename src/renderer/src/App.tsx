import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Toaster } from 'sonner'
import { ControllerWorkspace } from './components/ControllerWorkspace'
import { CodexRestartDialog } from './components/CodexRestartDialog'
import { DiagnosticsView } from './components/DiagnosticsView'
import { MappingsView } from './components/MappingsView'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { useControllerApp, type AppSection } from './hooks/useControllerApp'
import { sectionForShortcut } from './core/sectionShortcuts'
import { Button } from './components/ui/button'
import { TooltipProvider } from './components/ui/tooltip'

const sectionLabels: Record<AppSection, string> = {
  controller: 'Controller',
  mappings: 'Mappings',
  diagnostics: 'Diagnostics',
  settings: 'Settings'
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer failed', error, info)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal-error">
        <AlertTriangle size={26} strokeWidth={1.8} />
        <h1>Codex Controller could not finish loading</h1>
        <p>{this.state.error.message}</p>
        <Button type="button" onClick={() => window.location.reload()}>
          Reload app
        </Button>
      </main>
    )
  }
}

function AppContent(): React.JSX.Element {
  const model = useControllerApp()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const section = sectionForShortcut(event)
      if (!section) return
      event.preventDefault()
      model.setSection(section)
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('#main-content')?.focus()
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [model.setSection])

  return (
    <TooltipProvider delayDuration={450}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Skip to main workspace</a>
        <TopBar model={model} />
        <Sidebar model={model} />
        <main
          id="main-content"
          className="view-host"
          tabIndex={-1}
          aria-label={`${sectionLabels[model.section]} workspace`}
        >
          {model.section === 'controller' && <ControllerWorkspace model={model} />}
          {model.section === 'mappings' && <MappingsView model={model} />}
          {model.section === 'diagnostics' && <DiagnosticsView model={model} />}
          {model.section === 'settings' && <SettingsView model={model} />}
        </main>
        <CodexRestartDialog
          result={model.codexRestartPrompt}
          onDismiss={model.dismissCodexRestartPrompt}
        />
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors
          toastOptions={{ className: 'app-toast' }}
        />
      </div>
    </TooltipProvider>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  )
}
