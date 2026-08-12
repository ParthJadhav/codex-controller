import { z } from 'zod'
import { codexCommandById } from '../shared/codexCommands'
import { acceleratorFor, type ManagedBinding } from '../shared/codexKeybindings'
import {
  actionSafeties,
  consequentialConfirmationPolicies,
  controllerLightStatuses,
  feedbackTones,
  focusPolicies,
  gestureKinds,
  type ActionRequest,
  type FeedbackTone
} from '../shared/contracts'
import { mappedActionSchema, keyboardShortcutSchema } from './actionSchema'

/**
 * What the main process accepts from the renderer, and nothing else.
 *
 * `contextIsolation` and `sandbox` keep the page out of Node, but every IPC
 * handler is still a function a compromised or merely buggy renderer can call
 * with any argument it likes. Before validation was added, the handlers took whatever
 * arrived: `native:send` forwarded any command string straight to the Swift
 * bridge — including `action.execute`, which is the executor's own channel and
 * skips the arming and Accessibility gates the executor exists to apply — and
 * `overlay:show` threw inside `escapeHtml` on a non-string title while
 * `codex:apply-keymap` wrote arbitrary strings into a file another application
 * owns.
 *
 * The validation lives here rather than inline in the handlers so it can be
 * tested without standing up Electron, the way `MainWindowHandle` is.
 */

export type IpcRequest<T> = { ok: true; value: T } | { ok: false; message: string }

const describe = (error: z.ZodError): string => {
  const issue = error.issues[0]
  if (!issue) return 'it did not match the expected shape'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

const parse = <T>(schema: z.ZodType<T>, value: unknown, subject: string): IpcRequest<T> => {
  const result = schema.safeParse(value)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, message: `${subject} was refused (${describe(result.error)}).` }
}

/* -------------------------------------------------------------------------- */
/* native:send                                                                 */
/* -------------------------------------------------------------------------- */

/** No payload at all, which is different from an empty object. */
const noPayload = z.undefined()

/**
 * The bridge commands the interface is allowed to send, with the payload each
 * one takes.
 *
 * This is an allowlist, so a command the Swift bridge grows is unreachable from
 * the renderer until it is named here on purpose. `action.execute` and
 * `message.send` are deliberately absent: both dispatch synthetic input, and
 * the only sanctioned route to them is `actions:execute`, which arms
 * consequential actions and checks Accessibility first.
 *
 * The payload shapes mirror what the Swift side reads. A wrong-typed value is
 * not a crash there — it falls back to a default — so the failure it produces
 * is a control that silently behaves as though it were never configured.
 */
export const rendererNativeCommandSchemas = {
  'system.refresh': noPayload,
  'audio.verifyDualSenseUSBSpeaker': noPayload,
  'haptics.play': z.strictObject({ tone: z.enum(feedbackTones) }),
  'audio.configure': z.strictObject({
    experimentalDualSenseMicrophoneEnabled: z.boolean()
  }),
  'light.set': z.strictObject({
    status: z.enum(controllerLightStatuses),
    // The bridge parses this as `#rrggbb`; anything else leaves the light alone.
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
  }),
  'controller.configure': z.strictObject({
    axisEnterThreshold: z.number().min(0).max(1),
    axisReleaseThreshold: z.number().min(0).max(1),
    triggerEnterThreshold: z.number().min(0).max(1),
    triggerReleaseThreshold: z.number().min(0).max(1),
    touchpadPointerEnabled: z.boolean(),
    touchpadPointerSpeed: z.number().min(0.5).max(2.5)
  })
} as const satisfies Record<string, z.ZodType>

export type RendererNativeCommand = keyof typeof rendererNativeCommandSchemas

export const rendererNativeCommands = Object.keys(
  rendererNativeCommandSchemas
) as RendererNativeCommand[]

export interface NativeSendRequest {
  command: RendererNativeCommand
  payload?: unknown
}

const nativeSendEnvelope = z.strictObject({
  command: z.string().max(120),
  payload: z.unknown().optional()
})

/**
 * Refuses anything the interface has no business sending, before the command
 * reaches the bridge's stdin.
 */
export const parseNativeSend = (value: unknown): IpcRequest<NativeSendRequest> => {
  const envelope = parse(nativeSendEnvelope, value, 'A native bridge command')
  if (!envelope.ok) return envelope

  const { command, payload } = envelope.value
  if (!Object.hasOwn(rendererNativeCommandSchemas, command)) {
    return {
      ok: false,
      message: `The interface may not send "${command}" to the native bridge.`
    }
  }
  const allowed = command as RendererNativeCommand
  const parsed = rendererNativeCommandSchemas[allowed].safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      message: `The payload for "${allowed}" was refused (${describe(parsed.error)}).`
    }
  }
  return { ok: true, value: { command: allowed, payload: parsed.data } }
}

/* -------------------------------------------------------------------------- */
/* actions:execute                                                             */
/* -------------------------------------------------------------------------- */

const actionRequestSchema: z.ZodType<ActionRequest> = z.strictObject({
  bindingId: z.string().min(1).max(200).optional(),
  action: mappedActionSchema,
  focusPolicy: z.enum(focusPolicies),
  safety: z.enum(actionSafeties),
  gesture: z.enum(gestureKinds).optional(),
  confirmationPolicy: z.enum(consequentialConfirmationPolicies).optional()
})

export const parseActionRequest = (value: unknown): IpcRequest<ActionRequest> =>
  parse(actionRequestSchema, value, 'The action')

/* -------------------------------------------------------------------------- */
/* overlay:show                                                                */
/* -------------------------------------------------------------------------- */

export interface OverlayRequest {
  title: string
  detail: string
  tone: FeedbackTone
}

const overlayRequestSchema: z.ZodType<OverlayRequest> = z.strictObject({
  // The overlay HTML-escapes both of these; a non-string threw before it got
  // that far and took the handler with it.
  title: z.string().min(1).max(200),
  detail: z.string().max(2_000),
  tone: z.enum(feedbackTones)
})

export const parseOverlayRequest = (value: unknown): IpcRequest<OverlayRequest> =>
  parse(overlayRequestSchema, value, 'The overlay')

/* -------------------------------------------------------------------------- */
/* system:open-settings                                                        */
/* -------------------------------------------------------------------------- */

export const systemSettingsPanes = [
  'accessibility',
  'inputMonitoring',
  'microphone',
  'sound'
] as const
export type SystemSettingsPane = (typeof systemSettingsPanes)[number]

/**
 * The pane indexes a lookup table whose result is interpolated into a URL that
 * gets handed to `shell.openExternal`, so an unchecked key — `constructor`,
 * say — puts something other than an anchor name in that URL.
 */
export const parseSystemSettingsPane = (value: unknown): IpcRequest<SystemSettingsPane> =>
  parse(z.enum(systemSettingsPanes), value, 'The settings pane')

/* -------------------------------------------------------------------------- */
/* codex:keymap-status, codex:apply-keymap                                     */
/* -------------------------------------------------------------------------- */

/**
 * A binding Codex Controller offers to write into `~/.codex/keybindings.json`.
 *
 * That file belongs to another application, so the shape check is not enough:
 * the command has to be one in the shared registry that Codex ships *unbound*
 * — a command Codex already binds must never be rewritten — and the accelerator
 * has to be the one this shortcut actually produces. Deriving it again here is
 * what stops an arbitrary string reaching the file: an accelerator the renderer
 * invented cannot survive `acceleratorFor`.
 */
const managedBindingSchema = z
  .strictObject({
    commandId: z.string().min(1).max(160),
    title: z.string().min(1).max(160),
    accelerator: z.string().min(1).max(64),
    shortcut: keyboardShortcutSchema
  })
  .superRefine((binding, context) => {
    const command = codexCommandById(binding.commandId)
    if (!command) {
      context.addIssue({
        code: 'custom',
        path: ['commandId'],
        message: `${binding.commandId} is not a Codex command Codex Controller manages`
      })
    } else if (command.shipsDefault) {
      context.addIssue({
        code: 'custom',
        path: ['commandId'],
        message: `${binding.commandId} already ships bound in Codex and is never rewritten`
      })
    }
    if (acceleratorFor(binding.shortcut) !== binding.accelerator) {
      context.addIssue({
        code: 'custom',
        path: ['accelerator'],
        message: 'the accelerator must be the one this shortcut produces'
      })
    }
  })

const managedBindingsSchema: z.ZodType<ManagedBinding[]> = z.array(managedBindingSchema).max(64)

export const parseManagedBindings = (value: unknown): IpcRequest<ManagedBinding[]> =>
  parse(managedBindingsSchema, value, 'The Codex keymap request')
