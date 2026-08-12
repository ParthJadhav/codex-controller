import { useEffect, useMemo } from 'react'
import {
  Bluetooth,
  Cable,
  Check,
  CircleAlert,
  Gamepad2,
  MousePointer2,
  RefreshCw,
  RotateCw,
  Vibrate
} from 'lucide-react'
import { inputDisplayNames } from '@shared/contracts'
import type { ControllerAppModel, StickDiagnostics } from '../hooks/useControllerApp'
import { permissionPresentation } from '../core/permissionStatus'
import {
  rotationCounts,
  rotationVerdict,
  type RotationStickId,
  type RotationTraceEntry
} from '../core/rotationDiagnostics'
import { Button } from './ui/button'

type SettingsPane = 'accessibility' | 'microphone' | 'inputMonitoring' | 'sound'

interface AccessRow {
  id: string
  label: string
  detail: string
  allowed: boolean
  /** Healthy rows still need a value; problem rows need a way out. */
  status: string
  pane?: SettingsPane
}

function StatFigure({
  icon,
  label,
  value,
  detail,
  tone = 'quiet'
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  tone?: 'quiet' | 'warning'
}): React.JSX.Element {
  return (
    <div className="stat-figure" data-tone={tone}>
      <span className="stat-figure-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="stat-figure-label">{label}</span>
      <strong className="stat-figure-value">{value}</strong>
      <span className="stat-figure-detail">{detail}</span>
    </div>
  )
}

/**
 * Healthy access is stated in neutral text; only a missing grant gets colour and
 * a button. Sorting problems first means the list answers "what is wrong" in the
 * first row rather than in the fourth.
 */
function AccessRowItem({ row }: { row: AccessRow }): React.JSX.Element {
  return (
    <div className="access-row" data-allowed={row.allowed}>
      <span className="access-row-icon" aria-hidden="true">
        {row.allowed ? <Check size={14} strokeWidth={2.6} /> : <CircleAlert size={14} strokeWidth={2.2} />}
      </span>
      <span className="access-row-copy">
        <strong>{row.label}</strong>
        <small>{row.detail}</small>
      </span>
      <span className="access-row-status">{row.status}</span>
      {row.pane && !row.allowed && (
        // Several rows can be unmet at once, and a screen reader listing four
        // buttons all called "Open Settings" gives no way to tell which pane
        // each one opens. The visible label stays short; the accessible name
        // carries the row.
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Open Settings for ${row.label}`}
          onClick={() => void window.controllerControls.system.openSettings(row.pane as SettingsPane)}
        >
          Open Settings
        </Button>
      )}
    </div>
  )
}

/**
 * One stick's answer to "did my circle become a rotation step".
 *
 * The four readings are ordered the way the question gets debugged: whether
 * samples arrive at all, whether they are far enough out for the angle to be
 * read, how much travel is banked toward the next step, and how many samples
 * were thrown away as impossible jumps. A stick can fail at any one of those
 * and the failures need different fixes.
 */
function StickRotationCard({
  input,
  telemetry,
  trace
}: {
  input: RotationStickId
  telemetry: StickDiagnostics['left']
  trace: readonly RotationTraceEntry[]
}): React.JSX.Element {
  const counts = rotationCounts(trace, input)
  const verdict = rotationVerdict(telemetry, counts, telemetry.everTracked)
  const steps = counts.clockwise + counts.counterclockwise

  return (
    <div className="rotation-card" data-tracking={telemetry.tracking} data-detected={steps > 0}>
      <div className="rotation-card-head">
        <strong>{inputDisplayNames[input]}</strong>
        <span className="rotation-card-steps tabular">
          {counts.clockwise} CW · {counts.counterclockwise} CCW
        </span>
      </div>
      <p className="rotation-card-verdict">{verdict}</p>
      <dl className="rotation-readouts">
        <div>
          <dt>Deflection</dt>
          <dd className="tabular">{telemetry.magnitude.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Angle</dt>
          <dd className="tabular">
            {telemetry.tracking ? `${telemetry.angleDegrees.toFixed(0)}°` : '—'}
          </dd>
        </div>
        <div>
          <dt>Banked</dt>
          <dd className="tabular">{telemetry.bankedDegrees.toFixed(0)}° / 90°</dd>
        </div>
        <div>
          <dt>Dropped</dt>
          <dd className="tabular">{telemetry.rejectedSamples}</dd>
        </div>
      </dl>
    </div>
  )
}

export function DiagnosticsView({ model }: { model: ControllerAppModel }): React.JSX.Element {
  useEffect(() => {
    void model.refreshSystem()
  }, [model.refreshSystem])

  const TransportIcon = model.controller.transport === 'Bluetooth' ? Bluetooth : Cable
  const microphone = permissionPresentation(model.system?.microphonePermission)
  const audio = model.system?.audio
  const wiredControllerAudio =
    audio?.controllerAudioKind === 'wiredHeadset' || audio?.controllerAudioKind === 'usbBuiltIn'
  const usbBuiltInSpeakerAvailable = audio?.usbBuiltInSpeakerAvailable === true
  const pointerStatus = model.controller.touchpadPointerStatus
  const pointerReady = pointerStatus === 'ready'
  const pointerDiagnostics = model.controller.touchpadPointerDiagnostics
  const pointerSource =
    pointerDiagnostics?.source === 'dualsenseHID'
      ? 'Direct HID contacts'
      : pointerDiagnostics?.source === 'gameControllerTouchpad'
        ? 'GameController contacts'
        : pointerDiagnostics?.source === 'gameControllerFallback'
          ? 'GameController fallback'
          : 'Waiting for controller'

  const rows = useMemo<AccessRow[]>(() => {
    const list: AccessRow[] = [
      {
        id: 'bridge',
        label: 'Native bridge',
        detail: 'The Swift helper that talks to the controller and macOS APIs',
        allowed: Boolean(model.system?.nativeBridgeAvailable),
        status: model.system?.nativeBridgeAvailable ? 'Running' : 'Not running'
      },
      {
        id: 'accessibility',
        label: 'Accessibility',
        detail: 'Required for keyboard shortcuts, text insertion, and pointer control',
        allowed: Boolean(model.system?.accessibilityTrusted),
        status: model.system?.accessibilityTrusted ? 'Allowed' : 'Required',
        pane: 'accessibility'
      },
      {
        id: 'microphone',
        label: 'Microphone',
        detail: 'Required to verify the DualSense microphone route',
        allowed: microphone.allowed,
        status: microphone.label,
        pane: 'microphone'
      },
      {
        id: 'inputMonitoring',
        label: 'Input Monitoring',
        detail: 'Background hardware input while another app is frontmost',
        allowed: Boolean(model.system?.inputMonitoringTrusted),
        status: model.system?.inputMonitoringTrusted ? 'Allowed' : 'Check access',
        pane: 'inputMonitoring'
      },
      {
        id: 'audio',
        label: 'Controller audio',
        detail: `In: ${audio?.defaultInputName ?? 'Unavailable'} · Out: ${audio?.defaultOutputName ?? 'Unavailable'}`,
        allowed: wiredControllerAudio || Boolean(audio?.experimentalBuiltInMicrophoneAvailable),
        status: wiredControllerAudio
          ? usbBuiltInSpeakerAvailable
            ? 'USB built-in speaker'
            : 'USB headset route'
          : audio?.experimentalBuiltInMicrophoneAvailable
            ? 'Experimental Bluetooth mic'
            : 'System audio only',
        pane: 'sound'
      }
    ]
    // Problems first: the list should answer "what is wrong" in its first row.
    return [...list].sort((left, right) => Number(left.allowed) - Number(right.allowed))
  }, [
    audio,
    microphone.allowed,
    microphone.label,
    model.system,
    usbBuiltInSpeakerAvailable,
    wiredControllerAudio
  ])

  const problems = rows.filter((row) => !row.allowed).length

  return (
    <div className="page diagnostics-view">
      <header className="page-head">
        <div>
          <h1>Diagnostics</h1>
          <p>
            {problems === 0
              ? 'Everything Codex Controller needs is available.'
              : `${problems} item${problems === 1 ? '' : 's'} need attention.`}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void model.refreshSystem()}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </Button>
      </header>

      <div className="page-body">
        <div className="stat-row">
          <StatFigure
            icon={<Gamepad2 size={16} strokeWidth={1.9} />}
            label="Controller"
            value={model.controller.connected ? model.controller.productCategory : 'Disconnected'}
            detail={
              model.controller.connected
                ? model.controller.name
                : 'Connect over USB or pair over Bluetooth'
            }
            tone={model.controller.connected ? 'quiet' : 'warning'}
          />
          <StatFigure
            icon={<TransportIcon size={16} strokeWidth={1.9} />}
            label="Transport"
            value={model.controller.connected ? model.controller.transport : '—'}
            detail={
              model.controller.batteryLevel === null
                ? 'Battery level unavailable'
                : `${Math.round(model.controller.batteryLevel * 100)}% battery`
            }
          />
          <StatFigure
            icon={<MousePointer2 size={16} strokeWidth={1.9} />}
            label="Touchpad pointer"
            value={
              pointerReady
                ? 'Ready'
                : pointerStatus === 'needsAccessibility'
                  ? 'Needs access'
                  : pointerStatus === 'disabled'
                    ? 'Off'
                    : 'Unavailable'
            }
            detail={
              pointerReady
                ? `${pointerSource} · ${pointerDiagnostics?.contacts ?? 0} touches`
                : pointerStatus === 'needsAccessibility'
                  ? 'Allow Accessibility to post pointer events'
                  : pointerStatus === 'disabled'
                    ? 'Enable it in Settings'
                    : 'Connect a DualSense to verify coordinates'
            }
            tone={pointerStatus === 'needsAccessibility' ? 'warning' : 'quiet'}
          />
          <StatFigure
            icon={<Vibrate size={16} strokeWidth={1.9} />}
            label="Capabilities"
            value={`${model.controller.capabilities.length} controls`}
            detail={model.controller.supportsHaptics ? 'Haptics available' : 'Haptics unavailable'}
          />
        </div>

        <div className="diagnostic-columns">
          <section className="panel" aria-labelledby="access-heading">
            <div className="panel-head">
              <h2 id="access-heading">System access</h2>
              <p>What macOS has granted this app</p>
            </div>
            <div className="access-list">
              {rows.map((row) => (
                <AccessRowItem key={row.id} row={row} />
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="monitor-heading">
            <div className="panel-head">
              <h2 id="monitor-heading">Input monitor</h2>
              <p>Newest hardware edges first</p>
              <span className="live-dot" role="status" aria-label="Live">
                Live
              </span>
            </div>
            <div className="event-scroll">
              {model.controllerEvents.length === 0 ? (
                <div className="event-empty">
                  <p>Press a control to begin the trace.</p>
                </div>
              ) : (
                <table className="event-table" aria-label="Controller input events">
                  <thead>
                    <tr>
                      <th scope="col">Input</th>
                      <th scope="col">Value</th>
                      <th scope="col">Edge</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.controllerEvents.slice(0, 40).map((event) => (
                      <tr key={event.id}>
                        <td>
                          <strong>{inputDisplayNames[event.input]}</strong>
                        </td>
                        <td className="tabular">{event.value.toFixed(3)}</td>
                        <td data-pressed={event.pressed}>{event.pressed ? 'Pressed' : 'Released'}</td>
                        <td>{event.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        <section className="panel rotation-panel" aria-labelledby="rotation-heading">
          <div className="panel-head">
            <h2 id="rotation-heading">Stick rotation</h2>
            <p>
              Rotate a stick through a full circle past half deflection. A step is one quarter
              turn.
            </p>
            <span className="live-dot" role="status" aria-label="Live">
              Live
            </span>
          </div>
          <div className="rotation-body">
            <div className="rotation-cards">
              <StickRotationCard
                input="leftStickClick"
                telemetry={model.stickDiagnostics.left}
                trace={model.rotationTrace}
              />
              <StickRotationCard
                input="rightStickClick"
                telemetry={model.stickDiagnostics.right}
                trace={model.rotationTrace}
              />
            </div>
            <div className="rotation-trace">
              {model.rotationTrace.length === 0 ? (
                <div className="event-empty">
                  <p>No rotation steps yet.</p>
                </div>
              ) : (
                <table className="event-table" aria-label="Stick rotation steps">
                  <thead>
                    <tr>
                      <th scope="col">Stick</th>
                      <th scope="col">Direction</th>
                      <th scope="col">Deflection</th>
                      <th scope="col">Angle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.rotationTrace.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <strong>{inputDisplayNames[entry.input]}</strong>
                        </td>
                        <td data-pressed={true}>
                          <RotateCw
                            size={11}
                            aria-hidden="true"
                            style={{
                              verticalAlign: '-1px',
                              marginRight: 5,
                              transform:
                                entry.step === 'counterclockwise' ? 'scaleX(-1)' : undefined
                            }}
                          />
                          {entry.step === 'clockwise' ? 'Clockwise' : 'Counterclockwise'}
                        </td>
                        <td className="tabular">{entry.magnitude.toFixed(3)}</td>
                        <td className="tabular">{entry.angleDegrees.toFixed(0)}°</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
