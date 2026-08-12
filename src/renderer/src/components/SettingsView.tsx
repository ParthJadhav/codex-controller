import {
  Keyboard,
  Copy,
  Download,
  ExternalLink,
  Gamepad2,
  Headphones,
  LayoutGrid,
  Mic,
  MousePointer2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound
} from 'lucide-react'
import { useState } from 'react'
import { profileLimits } from '@shared/profileLimits'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { permissionPresentation } from '../core/permissionStatus'
import { codexCommandsNeedingSetup } from '@shared/codexCommands'
import {
  microDialModes,
  microParityLabels,
  microRoles,
  type MicroDialMode
} from '@shared/microProfile'
import { formatShortcut } from '../core/shortcutDisplay'
import { AutosaveStatus } from './AutosaveStatus'
import { ConfirmDialog } from './ConfirmDialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'
import { Switch } from './ui/switch'

function Section({
  id,
  title,
  description,
  icon,
  children
}: {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="settings-section" aria-labelledby={`${id}-title`}>
      <div className="settings-section-head">
        <span className="settings-section-icon" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="settings-group">{children}</div>
    </section>
  )
}

function Subhead({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="settings-subhead">
      <span aria-hidden="true">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  )
}

function Row({
  title,
  description,
  htmlFor,
  wide = false,
  children
}: {
  title: string
  description?: string
  htmlFor?: string
  /** Lets a cluster of buttons use the full row instead of a capped control column. */
  wide?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const Copy = htmlFor ? 'label' : 'div'
  return (
    <div className="settings-row" data-wide={wide}>
      <Copy className="settings-copy" htmlFor={htmlFor}>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </Copy>
      <div className="settings-control">{children}</div>
    </div>
  )
}

function ControllerSettingsSection({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const profile = model.activeProfile
  const pointerStatus = model.controller.connected
    ? model.controller.touchpadPointerStatus
    : profile.touchpadPointerEnabled
      ? 'disconnected'
      : 'disabled'
  const pointerStatusLabel =
    !model.isEnabled && profile.touchpadPointerEnabled
      ? 'Paused with dispatch'
      : {
          disabled: 'Off',
          ready: 'Ready',
          needsAccessibility: 'Needs Accessibility access',
          unavailable: 'Touch coordinates unavailable',
          disconnected: 'Connect controller to verify'
        }[pointerStatus]
  const pointerStatusTone =
    pointerStatus === 'ready'
      ? 'secondary'
      : pointerStatus === 'needsAccessibility' || pointerStatus === 'unavailable'
        ? 'warning'
        : 'secondary'

  const updateAnalogThreshold = (key: string, next: number): void => {
    if (key === 'axisEnterThreshold') {
      model.updateActiveProfile({
        axisEnterThreshold: next,
        axisReleaseThreshold: Math.min(profile.axisReleaseThreshold, next - 0.05)
      })
    } else if (key === 'axisReleaseThreshold') {
      model.updateActiveProfile({
        axisReleaseThreshold: Math.min(next, profile.axisEnterThreshold - 0.05)
      })
    } else if (key === 'triggerEnterThreshold') {
      model.updateActiveProfile({
        triggerEnterThreshold: next,
        triggerReleaseThreshold: Math.min(profile.triggerReleaseThreshold, next - 0.05)
      })
    } else {
      model.updateActiveProfile({
        triggerReleaseThreshold: Math.min(next, profile.triggerEnterThreshold - 0.05)
      })
    }
  }

  return (
    <Section
      id="settings-controller"
      title="Controller behavior"
      description="Pointer control, analog response, and dispatch feedback."
      icon={<Gamepad2 size={15} strokeWidth={1.9} />}
    >
      <Subhead
        icon={<MousePointer2 size={14} strokeWidth={1.9} />}
        title="Touchpad pointer"
        description="Use the DualSense touch surface as a macOS trackpad."
      />
      <Row
        title="Move and click the pointer"
        description="Drag one finger to move; press the touchpad for a primary click."
      >
        <Badge variant={pointerStatusTone}>{pointerStatusLabel}</Badge>
        <Switch
          aria-label="Move and click the pointer"
          checked={profile.touchpadPointerEnabled}
          onCheckedChange={(checked) =>
            model.updateActiveProfile({ touchpadPointerEnabled: checked })
          }
        />
      </Row>
      <Row
        title="Pointer speed"
        description="How far the pointer travels for the same touch movement."
        htmlFor="pointer-speed"
      >
        <div className="settings-slider">
          <Input
            id="pointer-speed"
            type="range"
            aria-label="Touchpad pointer speed"
            aria-valuetext={`${profile.touchpadPointerSpeed.toFixed(2)} times`}
            min={0.5}
            max={2.5}
            step={0.05}
            value={profile.touchpadPointerSpeed}
            disabled={!profile.touchpadPointerEnabled}
            onChange={(event) =>
              model.updateActiveProfile({
                touchpadPointerSpeed: Number(event.currentTarget.value)
              })
            }
          />
          <output htmlFor="pointer-speed">{profile.touchpadPointerSpeed.toFixed(2)}×</output>
        </div>
      </Row>
      {pointerStatus === 'needsAccessibility' && (
        <Row
          title="Accessibility permission required"
          description="macOS needs access before Codex Controller can move the pointer."
        >
          <Button
            type="button"
            variant="secondary"
            onClick={() => void window.controllerControls.system.openSettings('accessibility')}
          >
            Open Accessibility Settings
          </Button>
        </Row>
      )}

      <Subhead
        icon={<SlidersHorizontal size={14} strokeWidth={1.9} />}
        title="Analog input"
        description="Activation and release thresholds prevent noisy stick and trigger input."
      />
      {(
        [
          ['Stick activation', 'axisEnterThreshold'],
          ['Stick release', 'axisReleaseThreshold'],
          ['Trigger activation', 'triggerEnterThreshold'],
          ['Trigger release', 'triggerReleaseThreshold']
        ] as const
      ).map(([label, key]) => {
        const value = profile[key as keyof typeof profile] as number
        return (
          <Row key={key} title={label} htmlFor={key}>
            <div className="settings-slider">
              <Input
                id={key}
                type="range"
                aria-label={label}
                aria-valuetext={`${Math.round(value * 100)} percent`}
                min={key.endsWith('EnterThreshold') ? 0.15 : 0.1}
                max={key.endsWith('ReleaseThreshold') ? 0.9 : 0.95}
                step={0.05}
                value={value}
                onChange={(event) => updateAnalogThreshold(key, Number(event.currentTarget.value))}
              />
              <output htmlFor={key}>{Math.round(value * 100)}%</output>
            </div>
          </Row>
        )
      })}
      <p className="settings-note">
        Release values stay below activation values automatically to prevent jitter.
      </p>

      <Subhead
        icon={<Gamepad2 size={14} strokeWidth={1.9} />}
        title="Feedback and safety"
        description="Confirm successful actions and protect consequential ones."
      />
      <Row title="Controller haptics" description="Pulse after a successful dispatch.">
        <Switch
          aria-label="Controller haptics"
          checked={profile.hapticsEnabled}
          onCheckedChange={(checked) => model.updateActiveProfile({ hapticsEnabled: checked })}
        />
      </Row>
      <Row title="Action overlay" description="Show a compact result above other windows.">
        <Switch
          aria-label="Action overlay"
          checked={profile.overlayEnabled}
          onCheckedChange={(checked) => model.updateActiveProfile({ overlayEnabled: checked })}
        />
      </Row>
      <Row
        title="Consequential action confirmation"
        description="How deliberate actions are confirmed before dispatch."
        htmlFor="confirmation-policy"
      >
        <NativeSelect
          id="confirmation-policy"
          value={profile.consequentialConfirmationPolicy}
          onChange={(event) =>
            model.updateActiveProfile({
              consequentialConfirmationPolicy: event.currentTarget
                .value as typeof profile.consequentialConfirmationPolicy
            })
          }
        >
          <option value="repeatGesture">Repeat the gesture</option>
          <option value="deliberateGestureOnly">Deliberate gestures only</option>
        </NativeSelect>
      </Row>
    </Section>
  )
}

function AudioPrivacySettingsSection({
  model
}: {
  model: ControllerAppModel
}): React.JSX.Element {
  const microphone = permissionPresentation(model.system?.microphonePermission)
  const audio = model.system?.audio
  const experimentalControllerMicrophoneAvailable =
    audio?.experimentalBuiltInMicrophoneAvailable === true
  const usbBuiltInMicrophoneAvailable = audio?.usbBuiltInMicrophoneAvailable === true
  const usbBuiltInSpeakerAvailable = audio?.usbBuiltInSpeakerAvailable === true
  const wiredControllerAudio =
    audio?.controllerAudioKind === 'wiredHeadset' || audio?.controllerAudioKind === 'usbBuiltIn'
  const controllerJackState =
    audio?.dualSenseInputJackConnected ?? audio?.dualSenseOutputJackConnected
  const controllerJackLabel =
    controllerJackState === true
      ? 'Headset connected'
      : controllerJackState === false
        ? 'Jack empty'
        : 'Jack state unavailable'

  return (
    <Section
      id="settings-audio"
      title="Audio and privacy"
      description="Active routes and the macOS permissions the controller audio checks need."
      icon={<ShieldCheck size={15} strokeWidth={1.9} />}
    >
      <Subhead
        icon={<Headphones size={14} strokeWidth={1.9} />}
        title="Controller audio"
        description="Live CoreAudio routes and honest DualSense capability boundaries."
      />
      <dl className="settings-facts">
        <div>
          <dt>Default voice input</dt>
          <dd>{audio?.defaultInputName ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>System output</dt>
          <dd>{audio?.defaultOutputName ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>USB controller audio</dt>
          <dd>
            {wiredControllerAudio
              ? `${audio?.dualSenseInputName ?? audio?.dualSenseOutputName} · ${
                  audio?.dualSenseInputTransport ?? audio?.dualSenseOutputTransport ?? 'USB'
                } · ${
                  usbBuiltInSpeakerAvailable ? 'Built-in speaker available' : controllerJackLabel
                }`
              : 'Not detected'}
          </dd>
        </div>
        <div>
          <dt>Built-in mic and speaker</dt>
          <dd>
            {usbBuiltInMicrophoneAvailable
              ? usbBuiltInSpeakerAvailable
                ? 'USB built-in microphone and speaker verified'
                : 'USB built-in microphone verified'
              : experimentalControllerMicrophoneAvailable
                ? usbBuiltInSpeakerAvailable
                  ? 'Bluetooth microphone experimental · USB speaker verified'
                  : 'Microphone verified experimentally · Bluetooth speaker unverified'
                : usbBuiltInSpeakerAvailable
                  ? 'USB built-in speaker verified · microphone uses system audio'
                  : 'Unavailable through supported macOS audio routes'}
          </dd>
        </div>
      </dl>
      <Row
        title="Experimental Bluetooth controller microphone"
        description="Uses the verified proprietary HID/Opus stream. Controller mappings pause while the route is being verified and are restored afterwards."
      >
        <Badge variant={experimentalControllerMicrophoneAvailable ? 'warning' : 'secondary'}>
          {experimentalControllerMicrophoneAvailable ? 'Experimental' : 'Unavailable'}
        </Badge>
        <Switch
          aria-label="Experimental Bluetooth controller microphone"
          checked={model.experimentalDualSenseMicrophoneEnabled}
          disabled={
            !experimentalControllerMicrophoneAvailable
          }
          onCheckedChange={model.setExperimentalDualSenseMicrophoneEnabled}
        />
      </Row>
      <Row
        title="Wired built-in speaker"
        description="Sends FL/FR over the four-channel USB CoreAudio device and applies the controller’s internal-speaker HID route. The previous macOS output is restored after the one-second test."
      >
        <Button
          type="button"
          variant="secondary"
          disabled={!usbBuiltInSpeakerAvailable || model.isSpeakerTestRunning}
          onClick={() => void model.verifyUSBControllerSpeaker()}
        >
          {model.isSpeakerTestRunning ? 'Testing…' : 'Test wired speaker'}
        </Button>
      </Row>
      <p className="settings-note">
        Sony does not support the built-in microphone or speaker on Mac. The experimental
        microphone path bypasses CoreAudio and is verified only on the locally tested Bluetooth
        DualSense. A data-capable USB connection exposes a two-channel input and four-channel
        output whose built-in mic and speaker paths were acoustically verified with the headset
        jack empty. Bluetooth speaker playback remains unverified.
      </p>
      <div className="settings-row" data-wide="true">
        <div className="settings-control settings-control-start">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void window.controllerControls.system.openSettings('sound')}
          >
            Open Sound Settings
          </Button>
          <Button asChild type="button" variant="ghost">
            <a
              href="https://www.playstation.com/en-us/support/hardware/pair-dualsense-controller-bluetooth/"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} aria-hidden="true" />
              Sony compatibility
            </a>
          </Button>
        </div>
      </div>

      <Subhead
        icon={<Mic size={14} strokeWidth={1.9} />}
        title="Controller audio"
        description="The DualSense's own microphone and speaker routes."
      />
      <p className="settings-note">
        Dictation itself is Codex's — holding Create holds Codex's dictation shortcut. These
        controls only describe and verify the controller's audio hardware.
      </p>
      <Row title="Microphone" description="Required to verify the DualSense microphone route.">
        <Badge variant={microphone.allowed ? 'secondary' : 'warning'}>{microphone.label}</Badge>
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            if (microphone.requestable) {
              await window.controllerControls.system.requestMediaAccess()
              await model.refreshSystem()
            } else {
              await window.controllerControls.system.openSettings('microphone')
            }
          }}
        >
          {microphone.requestable ? 'Request access' : microphone.allowed ? 'Review' : 'Open Settings'}
        </Button>
      </Row>
    </Section>
  )
}

/**
 * Codex registers these commands but ships no shortcut for them, so the key
 * Codex Controller posts is only half the wiring — the other half is assigning the
 * same key inside Codex. Listing them here is the difference between a control
 * that quietly does nothing and one the user can fix in a minute.
 */
/**
 * The Micro companion profile and its dial.
 *
 * Every role carries a parity badge because the interesting part of this
 * profile is where it stops being Micro. Agent slots select tasks by position
 * rather than following Micro's assignable, per-task-lit slots, and the light
 * bar cannot be six lights. Saying so here is cheaper than a user discovering it
 * and concluding the app is broken.
 */
function MicroCompanionSection({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const active = model.isMicroCompanionProfile

  return (
    <Section
      id="settings-micro"
      title="Codex Micro companion"
      description="An optional profile that lays Codex Micro’s control surface over the DualSense."
      icon={<LayoutGrid size={15} strokeWidth={1.9} />}
    >
      <Row
        title="Companion profile"
        description={
          active
            ? 'This profile is active. Your other profiles are unchanged.'
            : 'Added alongside your existing profiles. Nothing you already have is replaced.'
        }
        wide
      >
        <Button
          type="button"
          variant={active ? 'ghost' : 'secondary'}
          onClick={model.addMicroCompanionProfile}
          disabled={!active && model.library.profiles.length >= profileLimits.profiles}
        >
          <LayoutGrid size={13} aria-hidden="true" />
          {active ? 'Already active' : 'Add Micro companion profile'}
        </Button>
      </Row>

      {active && (
        <Row
          title="Dial mode"
          description="Micro has one dial. This is the right stick turned in a circle."
          htmlFor="micro-dial-mode"
        >
          <NativeSelect
            id="micro-dial-mode"
            value={model.microDialMode ?? ''}
            onChange={(event) =>
              model.setMicroDialMode(event.currentTarget.value as MicroDialMode)
            }
          >
            {model.microDialMode === null && <option value="">Custom (edited)</option>}
            {microDialModes.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.title}
              </option>
            ))}
          </NativeSelect>
        </Row>
      )}

      {active &&
        model.microDialMode !== null &&
        microDialModes
          .filter((mode) => mode.id === model.microDialMode)
          .map((mode) => (
            <p key={mode.id} className="settings-note">
              <Badge>{microParityLabels[mode.parity]}</Badge> {mode.description}
            </p>
          ))}

      <div className="micro-parity-list">
        {microRoles.map((role) => (
          <div key={role.micro} className="micro-parity-row" data-parity={role.parity}>
            <div className="micro-parity-copy">
              <strong>{role.micro}</strong>
              <small>{role.detail}</small>
            </div>
            <Badge>{microParityLabels[role.parity]}</Badge>
          </div>
        ))}
      </div>

      <p className="settings-note">
        Codex registers no command that steps between models, so no gesture is mapped to model
        switching. Open the picker with Codex’s own <kbd>⌃⇧M</kbd> and drive it with the right
        stick’s directions.
      </p>
    </Section>
  )
}

function CodexSetupSection({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const keymap = model.codexKeymap
  const conflicts = keymap?.conflicts ?? []
  const unwritable = keymap?.unwritable ?? []
  // Shared with the sidebar alert so the two cannot disagree about whether
  // setup is finished.
  return (
    <Section
      id="settings-codex"
      title="Codex commands"
      description="Controls that need a matching shortcut inside Codex before they work."
      icon={<Keyboard size={15} strokeWidth={1.9} />}
    >
      <p className="settings-note">
        Open Codex, press <kbd>⌘/</kbd> for Keyboard Shortcuts, and give each command below the
        shortcut shown. Every other control already uses a shortcut Codex ships with.
      </p>
      <p className="settings-note">
        Codex Controller can tell that it sent the key, but not that Codex acted on it. Until you
        confirm a binding, using one of these controls reports that the key went out unbound
        instead of claiming it worked.
      </p>
      <p className="settings-note">
        When something here is unset, the sidebar offers to write it into Codex’s keymap at{' '}
        {keymap?.path ?? '~/.codex/keybindings.json'}, backing up your existing file first. It is
        only shown while there is something to do.
      </p>

      {unwritable.length > 0 && (
        <p className="settings-note" role="alert">
          {unwritable.map((entry) => (
            <span key={entry.commandId}>
              {entry.title} is mapped to {formatShortcut(entry.shortcut)}, which cannot be written
              as a Codex shortcut. Pick a different key for it, or set it by hand in Codex.
            </span>
          ))}
        </p>
      )}

      {conflicts.length > 0 && (
        <p className="settings-note" role="alert">
          {conflicts.map((entry) => (
            <span key={entry.commandId}>
              {entry.accelerator} is already assigned to <strong>{entry.heldBy}</strong> in Codex.
              Clear it there first, or pick a different key for {entry.title}.
            </span>
          ))}
        </p>
      )}

      {codexCommandsNeedingSetup.map(([name, entry]) => {
        const live = keymap?.entries.find((candidate) => candidate.commandId === entry.commandId)
        return (
          <Row
            key={name}
            title={entry.title}
            description={
              live?.state === 'alreadySet'
                ? `${entry.commandId} · bound in Codex`
                : live?.state === 'conflict'
                  ? `${entry.commandId} · conflicts with ${live.heldBy}`
                  : live?.state === 'set'
                    ? live.previous
                      ? `${entry.commandId} · Codex has ${live.previous}`
                      : `${entry.commandId} · not bound in Codex`
                    : entry.commandId
            }
            htmlFor={`codex-bound-${name}`}
          >
            <kbd className="settings-shortcut">{formatShortcut(entry.shortcut)}</kbd>
            <Switch
              id={`codex-bound-${name}`}
              checked={model.codexBindingsConfirmed.includes(entry.commandId)}
              onCheckedChange={(checked) =>
                model.setCodexBindingConfirmed(entry.commandId, checked)
              }
              aria-label={`I have bound ${entry.title} in Codex`}
            />
          </Row>
        )
      })}
      <p className="settings-note">
        The default profile already maps Create to Codex’s hold-to-dictate shortcut. If you
        remove or replace it, choose “Hold a keyboard shortcut” with “Start holding” to restore
        push-to-talk.
      </p>
    </Section>
  )
}

export function SettingsView({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const profile = model.activeProfile
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  return (
    <div className="page settings-view">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Changes save automatically and stay local to this Mac.</p>
        </div>
        <AutosaveStatus model={model} />
      </header>

      <div className="page-body settings-body">
        <CodexSetupSection model={model} />

        <Section
          id="settings-profiles"
          title="Profiles"
          description="Portable sets of controller mappings."
          icon={<UserRound size={15} strokeWidth={1.9} />}
        >
          <Row
            title="Active profile"
            description="The mapping set the controller uses right now."
            htmlFor="active-profile"
          >
            <NativeSelect
              id="active-profile"
              value={model.library.activeProfileId}
              onChange={(event) => model.selectProfile(event.currentTarget.value)}
            >
              {model.library.profiles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row
            title="Profile name"
            description="Shown in the command bar and profile menu."
            htmlFor="profile-name"
          >
            <Input
              id="profile-name"
              value={profile.name}
              maxLength={profileLimits.profileName}
              onChange={(event) => model.updateActiveProfile({ name: event.currentTarget.value })}
            />
          </Row>
          <Row
            title="Profile"
            description="Duplicate this profile or move it between Macs. Importing keeps your existing profiles."
            wide
          >
            <Button
              type="button"
              variant="secondary"
              onClick={model.duplicateProfile}
              disabled={model.library.profiles.length >= profileLimits.profiles}
            >
              <Copy size={13} aria-hidden="true" />
              Duplicate
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void model.importLibrary()}
              disabled={model.library.profiles.length >= profileLimits.profiles}
            >
              <Upload size={13} aria-hidden="true" />
              Import profile
            </Button>
            <Button type="button" variant="ghost" onClick={() => void model.exportLibrary()}>
              <Download size={13} aria-hidden="true" />
              Export profile
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="settings-delete-button"
              // The last profile cannot be deleted at all, so asking "are you
              // sure" about it would promise something the model then refuses.
              onClick={() =>
                model.library.profiles.length <= 1
                  ? model.deleteActiveProfile()
                  : setConfirmingDelete(true)
              }
            >
              <Trash2 size={13} aria-hidden="true" />
              Delete
            </Button>
          </Row>
        </Section>

        {/*
          Deleting a profile takes its mappings with it and autosave writes the
          smaller library 600 ms later; there is no undo and no second copy, so
          the prompt names the profile and how much of it goes.
        */}
        <ConfirmDialog
          open={confirmingDelete}
          title={`Delete “${profile.name}”?`}
          description={`This removes 1 profile and its ${profile.bindings.length} ${
            profile.bindings.length === 1 ? 'mapping' : 'mappings'
          }, leaving ${model.library.profiles.length - 1} ${
            model.library.profiles.length - 1 === 1 ? 'profile' : 'profiles'
          }. Saved automatically, and it cannot be undone.`}
          confirmLabel="Delete profile"
          onConfirm={() => {
            setConfirmingDelete(false)
            model.deleteActiveProfile()
          }}
          onCancel={() => setConfirmingDelete(false)}
        />

        <MicroCompanionSection model={model} />
        <ControllerSettingsSection model={model} />
        <AudioPrivacySettingsSection model={model} />
      </div>
    </div>
  )
}
