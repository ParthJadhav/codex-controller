import {
  codexCommandNeedingSetup,
  codexCommands,
  type CodexCommand,
  type CodexCommandName
} from './codexCommands'
import type { KeyboardShortcut, MappedAction } from './contracts'

/**
 * Writing the shortcuts Codex leaves unbound into Codex's own keymap file.
 *
 * Codex registers `composer.increaseReasoningEffort` and its siblings with no
 * default binding, and Codex Micro never needs one because its bridge runs
 * inside the renderer and calls command IDs directly. An outside app can only
 * post a key, so those controls are dead until a binding exists — and if the
 * user picks their own binding by hand, it almost certainly will not be the key
 * Codex Controller posts, which fails in a way that looks identical to a bug.
 *
 * Codex reads user bindings from `~/.codex/keybindings.json`: a flat
 * `{ command, key }` array, where a null key means "explicitly unbound". That is
 * ordinary user-owned configuration in the user's home directory, not app
 * internals, so Codex Controller can own both halves of the handshake and make the
 * key it posts and the key Codex listens for the same key by construction.
 *
 * This is only ever done on an explicit request. Writing a user's editor
 * bindings behind their back is off the table, and every write is backed up,
 * reported, and reversible.
 */

/** One entry of Codex's `keybindings.json`. */
export interface CodexKeybinding {
  command: string
  /** Electron accelerator, or null meaning the command is explicitly unbound. */
  key: string | null
}

const modifierAccelerators = {
  command: 'Command',
  control: 'Ctrl',
  option: 'Alt',
  shift: 'Shift'
} as const

/** Codex writes modifiers in this order; matching it keeps diffs readable. */
const modifierOrder = ['control', 'command', 'option', 'shift'] as const

/**
 * macOS virtual key code to the literal key name in an Electron accelerator.
 *
 * The mapping editor lets the user record any key, so this has to cover the
 * whole keyboard rather than just the keys we ship. A code with no entry
 * returns null and the binding is reported as one we cannot write, which is the
 * honest outcome — guessing a name Electron rejects would produce a keymap that
 * parses fine and silently never fires.
 */
const acceleratorKeys: Record<number, string> = {
  // Letters
  0x00: 'A', 0x0b: 'B', 0x08: 'C', 0x02: 'D', 0x0e: 'E', 0x03: 'F', 0x05: 'G',
  0x04: 'H', 0x22: 'I', 0x26: 'J', 0x28: 'K', 0x25: 'L', 0x2e: 'M', 0x2d: 'N',
  0x1f: 'O', 0x23: 'P', 0x0c: 'Q', 0x0f: 'R', 0x01: 'S', 0x11: 'T', 0x20: 'U',
  0x09: 'V', 0x0d: 'W', 0x07: 'X', 0x10: 'Y', 0x06: 'Z',
  // Digits
  0x1d: '0', 0x12: '1', 0x13: '2', 0x14: '3', 0x15: '4',
  0x17: '5', 0x16: '6', 0x1a: '7', 0x1c: '8', 0x19: '9',
  // Punctuation
  0x2b: ',', 0x2f: '.', 0x1b: '-', 0x18: '=', 0x21: '[', 0x1e: ']',
  0x2a: '\\', 0x29: ';', 0x27: "'", 0x32: '`', 0x2c: '/',
  // Named keys, using Electron's own accelerator vocabulary
  0x24: 'Return', 0x30: 'Tab', 0x31: 'Space', 0x33: 'Backspace', 0x35: 'Escape',
  0x75: 'Delete', 0x73: 'Home', 0x77: 'End', 0x74: 'PageUp', 0x79: 'PageDown',
  0x7b: 'Left', 0x7c: 'Right', 0x7d: 'Down', 0x7e: 'Up',
  // Function keys
  0x7a: 'F1', 0x78: 'F2', 0x63: 'F3', 0x76: 'F4', 0x60: 'F5', 0x61: 'F6',
  0x62: 'F7', 0x64: 'F8', 0x65: 'F9', 0x6d: 'F10', 0x67: 'F11', 0x6f: 'F12'
}

export const acceleratorFor = (shortcut: KeyboardShortcut): string | null => {
  const key = acceleratorKeys[shortcut.keyCode] ?? null
  if (key === null) return null
  const parts = modifierOrder
    .filter((modifier) => shortcut.modifiers.includes(modifier))
    .map((modifier) => modifierAccelerators[modifier])
  return [...parts, key].join('+')
}

/**
 * Every accelerator this build of Codex already ships bound, read out of the
 * installed command registry. A shortcut we assign has to avoid all of them, or
 * Codex's own conflict resolution would silently steal it back from whichever
 * command lost the race.
 *
 * `CmdOrCtrl` entries are expanded to their macOS meaning, `Command`.
 */
export const codexOccupiedAccelerators: ReadonlySet<string> = new Set([
  'Alt+1', 'Alt+2', 'Alt+Left', 'Alt+Right',
  'Command+,', 'Command+/', 'Command+1', 'Command+2', 'Command+3', 'Command+4',
  'Command+5', 'Command+6', 'Command+7', 'Command+8', 'Command+9',
  'Command+Alt+B', 'Command+Alt+C', 'Command+Alt+L', 'Command+Alt+N',
  'Command+Alt+O', 'Command+Alt+P', 'Command+Alt+R', 'Command+Alt+S',
  'Command+Alt+Shift+C', 'Command+Alt+Shift+O', 'Command+Alt+U',
  'Command+Alt+Left', 'Command+Alt+Right',
  'Command+B', 'Command+F', 'Command+J', 'Command+K', 'Command+L', 'Command+N',
  'Command+O', 'Command+P', 'Command+R', 'Command+T', 'Command+W', 'Command+Z',
  'Command+Shift+A', 'Command+Shift+B', 'Command+Shift+C', 'Command+Shift+D',
  'Command+Shift+E', 'Command+Shift+N', 'Command+Shift+O', 'Command+Shift+P',
  'Command+Shift+R', 'Command+Shift+S', 'Command+Shift+Z',
  'Command+Shift+[', 'Command+Shift+]', 'Command+[', 'Command+]',
  'Command+Left', 'Command+Right',
  'Ctrl+1', 'Ctrl+2', 'Ctrl+Alt+M', 'Ctrl+F', 'Ctrl+F4', 'Ctrl+N',
  'Ctrl+PageDown', 'Ctrl+PageUp', 'Ctrl+Tab', 'Ctrl+W', 'Ctrl+Y',
  'Ctrl+Shift+D', 'Ctrl+Shift+G', 'Ctrl+Shift+M', 'Ctrl+Shift+Tab',
  'Ctrl+Shift+V', 'Ctrl+Shift+Z', 'Ctrl+Shift+[', 'Ctrl+Shift+]',
  'Enter', 'Escape', 'MouseBack', 'MouseForward'
])

export interface ManagedBinding {
  commandId: string
  title: string
  accelerator: string
  shortcut: KeyboardShortcut
}

/** A mapping that means a Codex command but posts a key we cannot express. */
export interface UnwritableBinding {
  commandId: string
  title: string
  shortcut: KeyboardShortcut
}

export interface ManagedBindingSet {
  bindings: ManagedBinding[]
  unwritable: UnwritableBinding[]
}

/**
 * Something that carries mappings — a profile, or anything shaped like one.
 * Kept structural so this module does not depend on the profile type.
 */
interface BindingSource {
  bindings: ReadonlyArray<{ isEnabled: boolean; action: MappedAction }>
}

const actionsIn = function* (action: MappedAction): Generator<MappedAction> {
  yield action
  if (action.type !== 'sequence') return
  for (const step of action.sequenceSteps ?? []) yield* actionsIn(step.action)
}

/**
 * The bindings Codex Controller offers to write, derived from what the active
 * profile actually posts right now.
 *
 * Deriving from the live profile rather than a fixed list is what keeps the
 * "already set up" status honest. Re-record a shortcut, enable a control that
 * uses an unbound command, disable one, switch profiles — each changes what
 * Codex needs to have bound, and each has to move the status. A hardcoded pair
 * could only ever describe the profile it was written for.
 *
 * Only commands Codex ships unbound are candidates: a command Codex already
 * binds needs nothing from us and must never be rewritten. Disabled mappings
 * are skipped because they post nothing.
 */
export const managedCodexBindingsFor = (profile: BindingSource | null): ManagedBindingSet => {
  const bindings = new Map<string, ManagedBinding>()
  const unwritable = new Map<string, UnwritableBinding>()
  const seenCommands = new Set<string>()
  if (!profile) return { bindings: [], unwritable: [] }

  for (const binding of profile.bindings) {
    if (!binding.isEnabled) continue
    for (const action of actionsIn(binding.action)) {
      if (!action.shortcut) continue
      const entry = codexCommandNeedingSetup(action.shortcut, action.codexCommandId)
      if (!entry || seenCommands.has(entry.commandId)) continue
      seenCommands.add(entry.commandId)

      const accelerator = acceleratorFor(action.shortcut)
      if (accelerator === null) {
        unwritable.set(entry.commandId, {
          commandId: entry.commandId,
          title: entry.title,
          shortcut: action.shortcut
        })
        continue
      }
      // First enabled occurrence wins, including an occurrence nested inside a
      // sequence. A duplicate would only restate the same command.
      bindings.set(entry.commandId, {
        commandId: entry.commandId,
        title: entry.title,
        accelerator,
        shortcut: action.shortcut
      })
    }
  }

  return {
    bindings: [...bindings.values()].sort((a, b) => a.commandId.localeCompare(b.commandId)),
    unwritable: [...unwritable.values()]
  }
}

/** The shipped default pair, for callers with no profile in hand. */
export const managedCodexBindings = (): ManagedBinding[] => {
  const names: CodexCommandName[] = ['increaseReasoningEffort', 'decreaseReasoningEffort']
  return names.flatMap((name) => {
    const entry = codexCommands[name]
    if (entry.shipsDefault) return []
    const accelerator = acceleratorFor(entry.shortcut)
    if (accelerator === null) return []
    return [
      {
        commandId: entry.commandId,
        title: entry.title,
        accelerator,
        shortcut: entry.shortcut
      }
    ]
  })
}

export type BindingState = 'set' | 'alreadySet' | 'conflict'

export interface BindingPlanEntry extends ManagedBinding {
  state: BindingState
  /** What the user's file had for this command before, if anything. */
  previous: string | null
  /** For `conflict`: the other command already holding this accelerator. */
  heldBy?: string
}

export interface CodexKeymapPlan {
  entries: BindingPlanEntry[]
  /** The complete file contents to write, or null when nothing needs writing. */
  bindings: CodexKeybinding[] | null
  changed: boolean
  conflicts: BindingPlanEntry[]
}

const isManagedCommand = (bindings: ManagedBinding[], commandId: string): boolean =>
  bindings.some((entry) => entry.commandId === commandId)

/** Named in a conflict whose holder is a Codex built-in we cannot identify. */
export const codexBuiltInHolder = 'a built-in Codex shortcut'

/**
 * The shipped Codex command holding an accelerator, when the registry can name
 * one.
 *
 * `codexOccupiedAccelerators` is a flat list read out of the installed build, so
 * most of its entries belong to commands this table never needed to describe.
 * Those still conflict; they just conflict anonymously.
 */
const shippedCommandHolding = (accelerator: string): string | null => {
  for (const entry of Object.values(codexCommands) as CodexCommand[]) {
    if (!entry.shipsDefault) continue
    if (acceleratorFor(entry.shortcut) === accelerator) return entry.commandId
  }
  return null
}

/**
 * Whether Codex itself already answers this accelerator, for a command that is
 * not the one we are binding.
 *
 * Codex resolves a collision between its own binding and a user binding on its
 * own terms, and the loser is silent — the exact failure that made a control
 * look broken rather than unconfigured. So a managed accelerator landing on a
 * shipped one is refused up front instead of written and hoped for.
 *
 * The user's file gets the last word: rebinding the shipped command to some
 * other key (or unbinding it) frees the accelerator, and this says so whenever
 * the holder can be named.
 */
const occupiedByCodex = (
  accelerator: string,
  commandId: string,
  current: readonly CodexKeybinding[]
): { heldBy: string } | null => {
  if (!codexOccupiedAccelerators.has(accelerator)) return null
  const holder = shippedCommandHolding(accelerator)
  if (holder === commandId) return null
  if (holder !== null) {
    const moved = current.find((entry) => entry.command === holder)
    if (moved && moved.key !== accelerator) return null
  }
  return { heldBy: holder ?? codexBuiltInHolder }
}

/**
 * Works out what writing our bindings into an existing keymap would do, without
 * touching the disk, so the decision and the report can both be tested and the
 * user can be told what will change before it changes.
 *
 * Entries for commands we do not manage are preserved exactly. An accelerator
 * already claimed by a different command is reported as a conflict and nothing
 * is written for it, rather than quietly taking the binding away from whatever
 * the user assigned it to. "Claimed" covers both halves of Codex's keymap: the
 * user's own file, and the accelerators this Codex build ships bound
 * (`codexOccupiedAccelerators`) — a shipped binding is invisible in the file,
 * so checking only the file reported a clean "set" for an accelerator Codex was
 * always going to win.
 */
export const planCodexKeymap = (
  current: readonly CodexKeybinding[],
  managed: ManagedBinding[] = managedCodexBindings()
): CodexKeymapPlan => {
  const entries: BindingPlanEntry[] = managed.map((binding, index) => {
    const previous = current.find((entry) => entry.command === binding.commandId)?.key ?? null

    const desiredHolder = managed.find(
      (entry, candidate) =>
        candidate !== index && entry.accelerator === binding.accelerator
    )
    if (desiredHolder) {
      return {
        ...binding,
        state: 'conflict',
        previous,
        heldBy: desiredHolder.commandId
      }
    }
    const heldByOther = current.find(
      (entry) =>
        entry.key === binding.accelerator &&
        entry.command !== binding.commandId &&
        !isManagedCommand(managed, entry.command)
    )
    if (heldByOther) {
      return { ...binding, state: 'conflict', previous, heldBy: heldByOther.command }
    }
    const shipped = occupiedByCodex(binding.accelerator, binding.commandId, current)
    if (shipped) {
      return { ...binding, state: 'conflict', previous, heldBy: shipped.heldBy }
    }
    return {
      ...binding,
      state: previous === binding.accelerator ? 'alreadySet' : 'set',
      previous
    }
  })

  const writable = entries.filter((entry) => entry.state === 'set')
  if (writable.length === 0) {
    return { entries, bindings: null, changed: false, conflicts: entries.filter((e) => e.state === 'conflict') }
  }

  const rewritten = new Set(writable.map((entry) => entry.commandId))
  const bindings: CodexKeybinding[] = [
    ...current.filter((entry) => !rewritten.has(entry.command)),
    ...writable.map((entry) => ({ command: entry.commandId, key: entry.accelerator }))
  ]

  return {
    entries,
    bindings,
    changed: true,
    conflicts: entries.filter((entry) => entry.state === 'conflict')
  }
}

/** Rejects anything that is not Codex's documented `{command, key}` array. */
export const parseCodexKeymap = (raw: string): CodexKeybinding[] | null => {
  if (raw.trim().length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const bindings: CodexKeybinding[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return null
    const record = entry as Record<string, unknown>
    if (typeof record.command !== 'string') return null
    if (typeof record.key !== 'string' && record.key !== null) return null
    bindings.push({ command: record.command, key: record.key })
  }
  return bindings
}

/** Two-space JSON with a trailing newline, matching what Codex itself writes. */
export const serializeCodexKeymap = (bindings: readonly CodexKeybinding[]): string =>
  `${JSON.stringify(bindings, null, 2)}\n`
