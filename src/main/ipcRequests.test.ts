import { describe, expect, it } from 'vitest'
import { codexCommands } from '../shared/codexCommands'
import { acceleratorFor, managedCodexBindings } from '../shared/codexKeybindings'
import type { ActionRequest } from '../shared/contracts'
import {
  parseActionRequest,
  parseManagedBindings,
  parseNativeSend,
  parseOverlayRequest,
  parseSystemSettingsPane,
  rendererNativeCommands
} from './ipcRequests'

/**
 * Regression: an IPC handler is a function the renderer can call with
 * anything at all, so each one is checked here against what it is actually
 * allowed to receive.
 */

const refusal = (result: { ok: boolean; message?: string }): string => {
  expect(result.ok).toBe(false)
  return (result as { message: string }).message
}

describe('native:send allowlist', () => {
  it('accepts exactly the commands the interface sends', () => {
    // Kept in step with the `native.send` call sites in useControllerApp.
    expect([...rendererNativeCommands].sort()).toEqual([
      'audio.configure',
      'audio.verifyDualSenseUSBSpeaker',
      'controller.configure',
      'haptics.play',
      'light.set',
      'system.refresh'
    ])
  })

  /**
   * The whole point of the ticket: `action.execute` is the ActionExecutor's own
   * channel. Reaching it through the passthrough skips arming a consequential
   * action and the Accessibility check, which is every safety gate there is.
   */
  it('refuses action.execute', () => {
    const result = parseNativeSend({
      command: 'action.execute',
      payload: { action: { type: 'primaryClick', title: 'Click' } }
    })

    expect(refusal(result)).toContain('may not send "action.execute"')
  })

  it('refuses message.send and any other bridge command', () => {
    expect(parseNativeSend({ command: 'message.send', payload: { text: 'hi' } }).ok).toBe(false)
    expect(parseNativeSend({ command: 'audio.verifyControllerMicrophone' }).ok).toBe(false)
    expect(parseNativeSend({ command: '', payload: undefined }).ok).toBe(false)
  })

  it('refuses an envelope that is not a command at all', () => {
    expect(parseNativeSend(undefined).ok).toBe(false)
    expect(parseNativeSend('system.refresh').ok).toBe(false)
    expect(parseNativeSend({ command: 7 }).ok).toBe(false)
    expect(parseNativeSend({ command: 'system.refresh', extra: 1 }).ok).toBe(false)
  })

  it('passes the calls the interface really makes', () => {
    const accepted: unknown[] = [
      { command: 'system.refresh', payload: undefined },
      { command: 'audio.verifyDualSenseUSBSpeaker' },
      { command: 'haptics.play', payload: { tone: 'success' } },
      { command: 'audio.configure', payload: { experimentalDualSenseMicrophoneEnabled: true } },
      { command: 'light.set', payload: { status: 'codex', color: '#4f76ff' } },
      {
        command: 'controller.configure',
        payload: {
          axisEnterThreshold: 0.6,
          axisReleaseThreshold: 0.4,
          triggerEnterThreshold: 0.5,
          triggerReleaseThreshold: 0.3,
          touchpadPointerEnabled: true,
          touchpadPointerSpeed: 1.4
        }
      }
    ]
    for (const value of accepted) expect(parseNativeSend(value).ok).toBe(true)
  })

  /**
   * A wrong-typed payload is not a crash on the Swift side — it silently falls
   * back to a default, so the control behaves as though it were never
   * configured. Refusing it here is what makes that visible.
   */
  it('refuses a payload the bridge would silently ignore', () => {
    expect(parseNativeSend({ command: 'haptics.play', payload: { tone: 'boom' } }).ok).toBe(false)
    expect(parseNativeSend({ command: 'light.set', payload: { status: 'codex' } }).ok).toBe(false)
    expect(
      parseNativeSend({
        command: 'light.set',
        payload: { status: 'codex', color: 'javascript:alert(1)' }
      }).ok
    ).toBe(false)
    expect(
      parseNativeSend({
        command: 'audio.configure',
        payload: { experimentalDualSenseMicrophoneEnabled: 'yes' }
      }).ok
    ).toBe(false)
    expect(
      parseNativeSend({
        command: 'controller.configure',
        payload: { axisEnterThreshold: 4 }
      }).ok
    ).toBe(false)
  })

  it('refuses a payload on a command that takes none', () => {
    expect(parseNativeSend({ command: 'system.refresh', payload: { tone: 'success' } }).ok).toBe(
      false
    )
  })
})

describe('actions:execute payloads', () => {
  const request: ActionRequest = {
    bindingId: 'binding-1',
    action: {
      type: 'keyboardShortcut',
      title: 'Send message',
      shortcut: { keyCode: 36, keyDisplay: 'Return', modifiers: [] }
    },
    focusPolicy: 'focusIfNeeded',
    safety: 'normal',
    gesture: 'tap',
    confirmationPolicy: 'repeatGesture'
  }

  it('accepts a well-formed request unchanged', () => {
    const result = parseActionRequest(request)
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toEqual(request)
  })

  it('accepts a nested sequence', () => {
    expect(
      parseActionRequest({
        action: {
          type: 'sequence',
          title: 'Approve and continue',
          sequenceSteps: [
            {
              id: 'step-1',
              delayMilliseconds: 120,
              action: { type: 'primaryClick', title: 'Click' },
              focusPolicy: 'frontmostOnly',
              safety: 'consequential'
            }
          ]
        },
        focusPolicy: 'frontmostOnly',
        safety: 'normal'
      }).ok
    ).toBe(true)
  })

  it('refuses duplicate sibling step ids at any sequence depth', () => {
    expect(
      parseActionRequest({
        action: {
          type: 'sequence',
          title: 'Outer',
          sequenceSteps: [
            {
              id: 'outer-step',
              delayMilliseconds: 0,
              action: {
                type: 'sequence',
                title: 'Inner',
                sequenceSteps: [0, 1].map((delayMilliseconds) => ({
                  id: 'duplicate',
                  delayMilliseconds,
                  action: { type: 'primaryClick', title: 'Click' },
                  focusPolicy: 'frontmostOnly',
                  safety: 'normal'
                }))
              },
              focusPolicy: 'frontmostOnly',
              safety: 'normal'
            }
          ]
        },
        focusPolicy: 'frontmostOnly',
        safety: 'normal'
      }).ok
    ).toBe(false)
  })

  it('refuses an action type the executor has no case for', () => {
    expect(
      parseActionRequest({
        action: { type: 'runShellCommand', title: 'rm -rf' },
        focusPolicy: 'frontmostOnly',
        safety: 'normal'
      }).ok
    ).toBe(false)
  })

  it('refuses missing, extra and wrong-typed fields', () => {
    expect(parseActionRequest(null).ok).toBe(false)
    expect(parseActionRequest({ action: request.action }).ok).toBe(false)
    expect(parseActionRequest({ ...request, focusPolicy: 'always' }).ok).toBe(false)
    expect(parseActionRequest({ ...request, gesture: 'wiggle' }).ok).toBe(false)
    expect(parseActionRequest({ ...request, elevated: true }).ok).toBe(false)
    expect(
      parseActionRequest({
        ...request,
        action: { ...request.action, shortcut: { keyCode: 900, keyDisplay: 'X', modifiers: [] } }
      }).ok
    ).toBe(false)
  })

  it('names what it refused', () => {
    expect(refusal(parseActionRequest({ ...request, safety: 'urgent' }))).toContain('safety')
  })
})

describe('overlay:show payloads', () => {
  it('accepts what the dispatch path shows', () => {
    expect(parseOverlayRequest({ title: 'Send message', detail: 'Sent ⌘↩', tone: 'success' }).ok)
      .toBe(true)
    expect(parseOverlayRequest({ title: 'Send message', detail: '', tone: 'failure' }).ok).toBe(true)
  })

  /** A non-string title threw inside `escapeHtml` and took the handler with it. */
  it('refuses a title that is not a string', () => {
    expect(parseOverlayRequest({ title: { toString: 1 }, detail: 'x', tone: 'success' }).ok).toBe(
      false
    )
    expect(parseOverlayRequest({ title: 'x', detail: null, tone: 'success' }).ok).toBe(false)
    expect(parseOverlayRequest(undefined).ok).toBe(false)
  })

  it('refuses a tone the overlay has no accent for', () => {
    expect(parseOverlayRequest({ title: 'x', detail: 'y', tone: 'chartreuse' }).ok).toBe(false)
  })
})

describe('codex keymap payloads', () => {
  const managed = managedCodexBindings()

  it('accepts the set the interface derives from the active profile', () => {
    const result = parseManagedBindings(managed)
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toEqual(managed)
  })

  it('accepts an empty set', () => {
    expect(parseManagedBindings([]).ok).toBe(true)
  })

  /**
   * These strings are written into `~/.codex/keybindings.json`, a file another
   * application owns, so an accelerator has to be one this shortcut really
   * produces rather than whatever the caller supplied.
   */
  it('refuses an accelerator the shortcut does not produce', () => {
    const forged = [{ ...managed[0]!, accelerator: 'Command+Q' }]
    expect(refusal(parseManagedBindings(forged))).toContain('accelerator')
  })

  it('refuses a command Codex does not have', () => {
    const invented = [{ ...managed[0]!, commandId: 'shell.exec' }]
    expect(refusal(parseManagedBindings(invented))).toContain('commandId')
  })

  /** Rewriting a binding Codex already ships would be an unasked-for edit. */
  it('refuses a command Codex already ships bound', () => {
    const shipped = codexCommands.newTask
    const result = parseManagedBindings([
      {
        commandId: shipped.commandId,
        title: shipped.title,
        accelerator: acceleratorFor(shipped.shortcut)!,
        shortcut: shipped.shortcut
      }
    ])
    expect(refusal(result)).toContain('ships bound')
  })

  it('refuses anything that is not an array of bindings', () => {
    expect(parseManagedBindings(null).ok).toBe(false)
    expect(parseManagedBindings([{ commandId: 'x' }]).ok).toBe(false)
    expect(parseManagedBindings([{ ...managed[0]!, key: 'Ctrl+A' }]).ok).toBe(false)
  })
})

describe('system:open-settings panes', () => {
  it('accepts the four panes the interface links to', () => {
    for (const pane of ['accessibility', 'inputMonitoring', 'microphone', 'sound']) {
      expect(parseSystemSettingsPane(pane).ok).toBe(true)
    }
  })

  /** The pane indexes an object literal, so an inherited key is not a pane. */
  it('refuses a prototype key and anything else unknown', () => {
    expect(parseSystemSettingsPane('constructor').ok).toBe(false)
    expect(parseSystemSettingsPane('__proto__').ok).toBe(false)
    expect(parseSystemSettingsPane(42).ok).toBe(false)
  })
})
