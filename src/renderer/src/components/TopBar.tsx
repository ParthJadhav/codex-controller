import { memo } from 'react'
import {
  BatteryLow,
  BatteryMedium,
  Bluetooth,
  Cable,
  Check,
  ChevronDown,
  CircleSlash,
  Pause,
  Play,
  Settings2
} from 'lucide-react'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

function ControllerHealth({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const { connected, transport, batteryLevel, productCategory } = model.controller
  const TransportIcon = transport === 'Bluetooth' ? Bluetooth : Cable
  const percent = batteryLevel === null ? null : Math.round(batteryLevel * 100)
  const low = percent !== null && percent <= 20
  const BatteryIcon = low ? BatteryLow : BatteryMedium

  const detail = !connected
    ? 'Not connected'
    : percent === null
      ? transport === 'USB'
        ? 'Wired'
        : transport
      : `${transport} · ${percent}%`

  return (
    <button
      type="button"
      className="controller-health"
      data-connected={connected}
      data-low-battery={low}
      aria-label={`${connected ? productCategory : 'Controller'}: ${detail}. Open diagnostics.`}
      onClick={() => model.setSection('diagnostics')}
    >
      {connected ? (
        <TransportIcon size={14} strokeWidth={1.9} aria-hidden="true" />
      ) : (
        <CircleSlash size={14} strokeWidth={1.9} aria-hidden="true" />
      )}
      <span className="controller-health-name">
        {connected ? productCategory : 'No controller'}
      </span>
      {connected && (
        <>
          <span className="controller-health-separator" aria-hidden="true" />
          <span className="controller-health-detail">{percent === null ? transport : `${percent}%`}</span>
          {percent !== null && <BatteryIcon size={14} strokeWidth={1.9} aria-hidden="true" />}
        </>
      )}
    </button>
  )
}

function TopBarComponent({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const dispatching = model.isEnabled
  const dispatchLabel = dispatching ? 'Dispatching' : 'Paused'

  return (
    <header className="command-bar">
      <div className="command-bar-lead">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="profile-picker"
              aria-label={`Active profile: ${model.activeProfile.name}. Change profile.`}
            >
              <span className="profile-picker-label">Profile</span>
              <span className="profile-picker-name">{model.activeProfile.name}</span>
              <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="profile-menu">
            <DropdownMenuLabel>Switch profile</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={model.library.activeProfileId}
              onValueChange={model.selectProfile}
            >
              {model.library.profiles.map((profile) => (
                <DropdownMenuRadioItem key={profile.id} value={profile.id}>
                  {profile.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => model.setSection('settings')}>
              <Settings2 size={14} aria-hidden="true" />
              Manage profiles
              <span className="ui-dropdown-shortcut">⌘4</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="command-bar-trail">
        <ControllerHealth model={model} />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="dispatch-toggle"
              data-dispatching={dispatching}
              aria-pressed={dispatching}
              aria-label={`Controller dispatch: ${dispatchLabel}`}
              onClick={() => model.setIsEnabled(!dispatching)}
            >
              {dispatching ? (
                <Check size={13} strokeWidth={2.6} aria-hidden="true" />
              ) : (
                <Pause size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              )}
              <span>{dispatchLabel}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {dispatching ? (
              <>
                <Pause size={12} aria-hidden="true" /> Pause controller dispatch
              </>
            ) : (
              <>
                <Play size={12} aria-hidden="true" /> Resume controller dispatch
              </>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

export const TopBar = memo(
  TopBarComponent,
  (previous, next) =>
    previous.model.controller.connected === next.model.controller.connected &&
    previous.model.controller.productCategory === next.model.controller.productCategory &&
    previous.model.controller.transport === next.model.controller.transport &&
    previous.model.controller.batteryLevel === next.model.controller.batteryLevel &&
    previous.model.activeProfile.name === next.model.activeProfile.name &&
    previous.model.library === next.model.library &&
    previous.model.isEnabled === next.model.isEnabled &&
    previous.model.setSection === next.model.setSection &&
    previous.model.setIsEnabled === next.model.setIsEnabled &&
    previous.model.selectProfile === next.model.selectProfile
)
