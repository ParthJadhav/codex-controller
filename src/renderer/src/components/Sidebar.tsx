import { memo } from 'react'
import { Activity, CircleAlert, Gamepad2, Keyboard, ListTree, Settings2 } from 'lucide-react'
import { lightColors } from '../core/lightStatus'
import { diagnosticsAttention } from '../core/attention'
import { codexShortcutSummary } from '../core/codexShortcutStatus'
import type { ControllerAppModel, AppSection } from '../hooks/useControllerApp'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface NavigationEntry {
  id: AppSection
  label: string
  icon: typeof Gamepad2
  shortcut: string
  hint: string
}

/**
 * Shortcut numbers follow visual order. The hint text is rendered, so an
 * ordering that disagreed with `sections` in App.tsx would be a visible lie.
 */
const primaryNavigation: NavigationEntry[] = [
  { id: 'controller', label: 'Controller', icon: Gamepad2, shortcut: 'Meta+1', hint: '⌘1' },
  { id: 'mappings', label: 'Mappings', icon: ListTree, shortcut: 'Meta+2', hint: '⌘2' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity, shortcut: 'Meta+3', hint: '⌘3' }
]

const settingsEntry: NavigationEntry = {
  id: 'settings',
  label: 'Settings',
  icon: Settings2,
  shortcut: 'Meta+4',
  hint: '⌘4'
}

const lightDescriptions: Record<string, string> = {
  idle: 'Idle',
  codex: 'Codex ready',
  actions: 'Dispatching',
  attention: 'Needs attention',
  success: 'Action succeeded',
  failure: 'Action failed'
}

function NavItem({
  entry,
  model,
  badge,
  attention
}: {
  entry: NavigationEntry
  model: ControllerAppModel
  badge?: number
  attention?: boolean
}): React.JSX.Element {
  const Icon = entry.icon
  const selected = model.section === entry.id
  const badged = badge !== undefined && badge > 0
  // A bare "2" appended to the name reads as "Mappings 2" to a screen reader,
  // so the count is spelled out and the visual badge is hidden from the tree.
  const accessibleName = badged
    ? `${entry.label}, ${badge} conflict${badge === 1 ? '' : 's'}`
    : attention
      ? `${entry.label}, needs attention`
      : entry.label

  return (
    <button
      type="button"
      className="nav-item"
      data-selected={selected}
      aria-label={accessibleName === entry.label ? undefined : accessibleName}
      aria-current={selected ? 'page' : undefined}
      aria-keyshortcuts={entry.shortcut}
      onClick={() => model.setSection(entry.id)}
    >
      <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
      <span className="nav-item-label">{entry.label}</span>
      {badged ? (
        <span className="nav-item-badge" aria-hidden="true">
          {badge}
        </span>
      ) : attention ? (
        <span className="nav-item-dot" aria-hidden="true" />
      ) : (
        <span className="nav-item-hint" aria-hidden="true">
          {entry.hint}
        </span>
      )}
    </button>
  )
}

/**
 * Appears only when Codex is missing a shortcut this profile needs, and does the
 * writing in place.
 *
 * This lived in Settings, which is the wrong shape for it: it is not a
 * preference, it is a condition that stops controls working, and it is only true
 * some of the time. On the sidebar it is visible from anywhere in the app and
 * absent entirely once setup is finished, so it costs nothing when there is
 * nothing to say.
 *
 * A conflict or an unwritable key cannot be fixed by writing, so those send the
 * user to the Settings detail rather than offering a button that would refuse.
 */
function CodexShortcutAlert({ model }: { model: ControllerAppModel }): React.JSX.Element | null {
  const summary = codexShortcutSummary(model.codexKeymap)
  if (summary.alert === null) return null

  const blocked = summary.state === 'blocked'
  return (
    <button
      type="button"
      className="sidebar-alert"
      data-tone={blocked ? 'warning' : 'accent'}
      disabled={model.isApplyingCodexKeymap}
      onClick={() => {
        if (summary.action === 'apply') void model.applyCodexKeymap()
        else model.setSection('settings')
      }}
    >
      {blocked ? (
        <CircleAlert size={14} strokeWidth={2.1} aria-hidden="true" />
      ) : (
        <Keyboard size={14} strokeWidth={1.9} aria-hidden="true" />
      )}
      <span className="sidebar-alert-label">
        {model.isApplyingCodexKeymap ? 'Updating Codex…' : summary.alert}
      </span>
    </button>
  )
}

function SidebarComponent({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const attention = diagnosticsAttention(model.system)
  const conflicts = model.conflicts.length
  const lightLabel = lightDescriptions[model.lightStatus] ?? 'Idle'

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <nav className="sidebar-nav">
        {primaryNavigation.map((entry) => (
          <NavItem
            key={entry.id}
            entry={entry}
            model={model}
            badge={entry.id === 'mappings' ? conflicts : undefined}
            attention={entry.id === 'diagnostics' && attention.blocking}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        <CodexShortcutAlert model={model} />
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="light-status"
              role="status"
              aria-label={`Controller light: ${lightLabel}`}
            >
              <span
                className="light-status-dot"
                style={{ backgroundColor: lightColors[model.lightStatus] }}
                aria-hidden="true"
              />
              <span className="light-status-label">{lightLabel}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="light-legend-tip">
            <strong>Controller light</strong>
            <p>Shows the highest-priority activity, in this order:</p>
            <ol>
              <li>Action result</li>
              <li>Action dispatch</li>
              <li>Needs attention</li>
              <li>Codex availability</li>
              <li>Idle</li>
            </ol>
          </TooltipContent>
        </Tooltip>
        <NavItem entry={settingsEntry} model={model} />
      </div>
    </aside>
  )
}

export const Sidebar = memo(
  SidebarComponent,
  (previous, next) =>
    previous.model.section === next.model.section &&
    previous.model.setSection === next.model.setSection &&
    previous.model.conflicts.length === next.model.conflicts.length &&
    previous.model.system === next.model.system &&
    previous.model.lightStatus === next.model.lightStatus &&
    // Without these the alert would be computed once and then never move,
    // which is the same staleness the Settings row already had to be cured of.
    previous.model.codexKeymap === next.model.codexKeymap &&
    previous.model.isApplyingCodexKeymap === next.model.isApplyingCodexKeymap &&
    previous.model.applyCodexKeymap === next.model.applyCodexKeymap
)
