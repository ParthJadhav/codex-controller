import type { KeyboardShortcut, MappedAction } from './contracts'

/**
 * Codex's own commands, addressed the only way an outside app supportedly can:
 * by posting the keyboard shortcut the command is bound to.
 *
 * Codex keeps a command registry (`codex.command.*`) whose entries carry an
 * `electron.defaultKeybindings` list and a configurable `shortcutScope`. The
 * shortcuts below marked `shipsDefault` are the ones Codex already binds, read
 * from the installed application. The rest are commands Codex registers with no
 * default at all — the user assigns them once in Codex's Keyboard Shortcuts and
 * the suggested value here is what Codex Controller posts.
 *
 * Re-verify after a Codex update; the registry is not a published contract.
 */
export interface CodexCommand {
  /** Identifier in Codex's registry, for the setup list and for revalidation. */
  commandId: string
  title: string
  shortcut: KeyboardShortcut
  /** False when the user has to bind it inside Codex before it will work. */
  shipsDefault: boolean
}

const shortcut = (
  keyCode: number,
  keyDisplay: string,
  modifiers: KeyboardShortcut['modifiers']
): KeyboardShortcut => ({ keyCode, keyDisplay, modifiers })

export const codexCommands = {
  newTask: {
    commandId: 'newTask',
    title: 'New task',
    shortcut: shortcut(0x2d, 'N', ['command']),
    shipsDefault: true
  },
  openProjectPicker: {
    commandId: 'composer.openProjectPicker',
    title: 'Open project picker',
    shortcut: shortcut(0x1f, 'O', ['command', 'option', 'shift']),
    shipsDefault: true
  },
  openModelPicker: {
    commandId: 'composer.openModelPicker',
    title: 'Open model picker',
    shortcut: shortcut(0x2e, 'M', ['control', 'shift']),
    shipsDefault: true
  },
  startDictation: {
    commandId: 'composer.startDictation',
    title: 'Start dictation',
    shortcut: shortcut(0x02, 'D', ['control', 'shift']),
    shipsDefault: true
  },
  settings: {
    commandId: 'settings',
    title: 'Open Settings',
    shortcut: shortcut(0x2b, ',', ['command']),
    shipsDefault: true
  },
  /**
   * Codex registers `composer.submit` with no keybinding because the composer
   * already submits on Return — there is no "enter inserts a newline" setting
   * to invert it. Posting Return therefore sends the message with nothing for
   * the user to configure, which is worth more than a tidier-looking ⌘↩ that
   * does nothing until it is bound by hand.
   */
  submit: {
    commandId: 'composer.submit',
    title: 'Send message',
    shortcut: shortcut(0x24, '↩', []),
    shipsDefault: true
  },
  increaseReasoningEffort: {
    commandId: 'composer.increaseReasoningEffort',
    title: 'Increase reasoning effort',
    shortcut: shortcut(0x2f, '.', ['control', 'shift']),
    shipsDefault: false
  },
  decreaseReasoningEffort: {
    commandId: 'composer.decreaseReasoningEffort',
    title: 'Decrease reasoning effort',
    shortcut: shortcut(0x2b, ',', ['control', 'shift']),
    shipsDefault: false
  },

  /* ---------------------------------------------------------------------------
   * Codex Micro companion commands.
   *
   * Read from the same installed registry as the entries above. `thread1`
   * through `thread6` matter most: they are what makes six Agent-style task
   * slots reachable from outside Codex at all, and they ship bound, so the
   * slots work with no setup. They select the Nth task in Codex's own list —
   * that is not Micro's assignable-slot model, and the profile says so.
   * ------------------------------------------------------------------------ */
  task1: {
    commandId: 'thread1',
    title: 'Task 1',
    shortcut: shortcut(0x12, '1', ['command']),
    shipsDefault: true
  },
  task2: {
    commandId: 'thread2',
    title: 'Task 2',
    shortcut: shortcut(0x13, '2', ['command']),
    shipsDefault: true
  },
  task3: {
    commandId: 'thread3',
    title: 'Task 3',
    shortcut: shortcut(0x14, '3', ['command']),
    shipsDefault: true
  },
  task4: {
    commandId: 'thread4',
    title: 'Task 4',
    shortcut: shortcut(0x15, '4', ['command']),
    shipsDefault: true
  },
  task5: {
    commandId: 'thread5',
    title: 'Task 5',
    shortcut: shortcut(0x17, '5', ['command']),
    shipsDefault: true
  },
  task6: {
    commandId: 'thread6',
    title: 'Task 6',
    shortcut: shortcut(0x16, '6', ['command']),
    shipsDefault: true
  },
  approve: {
    commandId: 'approval.approve',
    title: 'Approve',
    shortcut: shortcut(0x24, '↩', []),
    shipsDefault: true
  },
  decline: {
    commandId: 'approval.decline',
    title: 'Decline',
    shortcut: shortcut(0x35, 'Esc', []),
    shipsDefault: true
  },
  toggleSidebar: {
    commandId: 'toggleSidebar',
    title: 'Toggle sidebar',
    shortcut: shortcut(0x0b, 'B', ['command']),
    shipsDefault: true
  },
  navigateBack: {
    commandId: 'navigateBack',
    title: 'Navigate back',
    shortcut: shortcut(0x21, '[', ['command']),
    shipsDefault: true
  },
  navigateForward: {
    commandId: 'navigateForward',
    title: 'Navigate forward',
    shortcut: shortcut(0x1e, ']', ['command']),
    shipsDefault: true
  },
  toggleFastMode: {
    commandId: 'composer.toggleFastMode',
    title: 'Toggle Fast mode',
    shortcut: shortcut(0x03, 'F', ['control', 'shift']),
    shipsDefault: false
  },
  togglePlanMode: {
    commandId: 'composer.togglePlanMode',
    title: 'Toggle Plan mode',
    shortcut: shortcut(0x23, 'P', ['control', 'shift']),
    shipsDefault: false
  },
  forkThread: {
    commandId: 'forkThread',
    title: 'Fork task',
    shortcut: shortcut(0x01, 'S', ['control', 'shift']),
    shipsDefault: false
  },

  /* ---------------------------------------------------------------------------
   * Voice chat.
   *
   * `startVoiceMode` is Codex's "Toggle voice chat" — its own description is
   * "start or stop voice chat", so one shortcut covers both ends of a call and
   * no call-state detection is needed for it. It also already ships bound.
   *
   * The other four ship unbound and are all `app` scope, meaning they are only
   * live while Codex is focused. Codex offers exactly one os-global voice
   * command (`realtimeVoice`, start-from-anywhere) and none for controlling a
   * call in progress, so mid-call actions cannot avoid bringing Codex forward.
   * ------------------------------------------------------------------------ */
  toggleVoiceChat: {
    commandId: 'composer.startVoiceMode',
    title: 'Toggle voice chat',
    shortcut: shortcut(0x09, 'V', ['control', 'shift']),
    shipsDefault: true
  },
  endVoiceChat: {
    commandId: 'realtimeVoice.endCall',
    title: 'End voice chat',
    shortcut: shortcut(0x0e, 'E', ['control', 'shift']),
    shipsDefault: false
  },
  toggleVoiceMicrophone: {
    commandId: 'realtimeVoice.toggleMicrophoneMute',
    title: 'Mute voice chat microphone',
    shortcut: shortcut(0x20, 'U', ['control', 'shift']),
    shipsDefault: false
  },
  toggleVoiceAudio: {
    commandId: 'realtimeVoice.toggleOutputMute',
    title: 'Mute voice chat audio',
    shortcut: shortcut(0x1f, 'O', ['control', 'shift']),
    shipsDefault: false
  },
  openVoiceControlWindow: {
    commandId: 'openControlWindow',
    title: 'Open voice control window',
    shortcut: shortcut(0x08, 'C', ['control', 'shift']),
    shipsDefault: false
  }
} as const satisfies Record<string, CodexCommand>

export type CodexCommandName = keyof typeof codexCommands

/** The commands the user has to bind in Codex before their control will work. */
export const codexCommandsNeedingSetup = (
  Object.entries(codexCommands) as Array<[CodexCommandName, CodexCommand]>
).filter(([, entry]) => !entry.shipsDefault)

const sameShortcut = (a: KeyboardShortcut, b: KeyboardShortcut): boolean =>
  a.keyCode === b.keyCode &&
  a.modifiers.length === b.modifiers.length &&
  a.modifiers.every((modifier) => b.modifiers.includes(modifier))

/**
 * A mapping that posts a key Codex has nothing bound to is silent — the press
 * lands and nothing happens, which is indistinguishable from a broken app. When
 * a mapping carries one of the suggested-but-unbound shortcuts, say so where
 * the mapping is edited instead of leaving the user to discover it by pressing.
 */
export const codexCommandNeedingSetup = (
  shortcut?: KeyboardShortcut,
  commandId?: string
): CodexCommand | null => {
  // An explicit command ID is authoritative: it survives the user re-recording
  // the key, which shortcut matching cannot.
  if (commandId) {
    const byId = codexCommandsNeedingSetup.find(([, entry]) => entry.commandId === commandId)
    return byId ? byId[1] : null
  }
  if (!shortcut) return null
  const match = codexCommandsNeedingSetup.find(([, entry]) =>
    sameShortcut(entry.shortcut, shortcut)
  )
  return match ? match[1] : null
}

/** Every command in the table, by its Codex command ID. */
export const codexCommandById = (commandId: string): CodexCommand | null =>
  (Object.values(codexCommands) as CodexCommand[]).find(
    (entry) => entry.commandId === commandId
  ) ?? null

/**
 * The command an action would post that Codex has nothing bound to, unless the
 * user has already told us they bound it.
 *
 * Dispatching such an action reports success — the key really was posted — but
 * nothing happens in Codex, which reads as a broken app rather than missing
 * setup. Codex's keymap is not readable from outside, so the user's own
 * acknowledgement is the only available signal, and this stays honest in both
 * directions: it warns until they confirm, and stops the moment they do.
 *
 * Returns `null` when the action posts a shortcut Codex ships bound, when it
 * posts nothing at all, or when the user has confirmed the binding.
 */
export const unacknowledgedCodexCommand = (
  action: Pick<MappedAction, 'shortcut' | 'codexCommandId'>,
  confirmedCommandIds: readonly string[] = []
): CodexCommand | null => {
  const pending = codexCommandNeedingSetup(action.shortcut, action.codexCommandId)
  if (!pending) return null
  return confirmedCommandIds.includes(pending.commandId) ? null : pending
}
