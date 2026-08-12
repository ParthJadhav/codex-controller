import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  parseCodexKeymap,
  planCodexKeymap,
  serializeCodexKeymap,
  type BindingPlanEntry,
  type CodexKeybinding,
  type ManagedBinding
} from '../shared/codexKeybindings'

/**
 * Reads and writes Codex's user keymap at `~/.codex/keybindings.json`.
 *
 * This is the one place Codex Controller touches a file another application owns,
 * so it is deliberately conservative: it refuses to write anything it could not
 * parse, keeps a restorable copy of what was there, replaces the file
 * atomically so a crash mid-write cannot leave Codex with a truncated keymap,
 * and never runs except from an explicit user action.
 */

export interface CodexKeymapStatus {
  path: string
  /** False when the file exists but is not Codex's documented shape. */
  readable: boolean
  entries: BindingPlanEntry[]
  conflicts: BindingPlanEntry[]
  /** True when every managed binding already matches what we would write. */
  satisfied: boolean
}

export interface CodexKeymapWriteResult {
  status: 'applied' | 'unchanged' | 'conflict' | 'unreadable' | 'failed'
  message: string
  path: string
  backupPath?: string
  entries: BindingPlanEntry[]
}

const KEYMAP_FILE = 'keybindings.json'
const BACKUP_SUFFIX = '.codex-controller-backup.json'

export const codexKeymapPath = (): string => join(homedir(), '.codex', KEYMAP_FILE)

/**
 * Every entry point takes the keymap path explicitly, defaulting to the real
 * one. Mocking `homedir` proved unreliable — a mock that silently fails to
 * apply points this module's writes at the user's actual Codex configuration,
 * which is exactly the accident this indirection makes impossible.
 */

const readRaw = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    // A keymap that has never been customised simply does not exist yet, which
    // is a normal starting state rather than a problem to report.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    return null
  }
}

export const readCodexKeymap = async (
  path: string = codexKeymapPath()
): Promise<{
  path: string
  bindings: CodexKeybinding[] | null
}> => {
  const raw = await readRaw(path)
  if (raw === null) return { path, bindings: null }
  return { path, bindings: parseCodexKeymap(raw) }
}

export const codexKeymapStatus = async (
  managed: ManagedBinding[],
  keymapPath: string = codexKeymapPath()
): Promise<CodexKeymapStatus> => {
  const { path, bindings } = await readCodexKeymap(keymapPath)
  if (bindings === null) {
    return { path, readable: false, entries: [], conflicts: [], satisfied: false }
  }
  const plan = planCodexKeymap(bindings, managed)
  return {
    path,
    readable: true,
    entries: plan.entries,
    conflicts: plan.conflicts,
    satisfied: !plan.changed && plan.conflicts.length === 0
  }
}

const describe = (entries: BindingPlanEntry[]): string =>
  entries.map((entry) => `${entry.title} → ${entry.accelerator}`).join(', ')

/**
 * Writes the managed bindings into Codex's keymap.
 *
 * Refuses on an unparseable file rather than replacing configuration it could
 * not read, and refuses on a conflict rather than taking an accelerator away
 * from a command the user assigned it to.
 */
export const applyCodexKeymap = async (
  managed: ManagedBinding[],
  path: string = codexKeymapPath()
): Promise<CodexKeymapWriteResult> => {
  if (managed.length === 0) {
    return {
      status: 'unchanged',
      message: 'Every command this profile posts already ships bound in Codex.',
      path,
      entries: []
    }
  }

  const raw = await readRaw(path)
  if (raw === null) {
    return {
      status: 'unreadable',
      message: `Could not read ${path}. Check its permissions and try again.`,
      path,
      entries: []
    }
  }

  const current = parseCodexKeymap(raw)
  if (current === null) {
    return {
      status: 'unreadable',
      message: `${path} is not in Codex's expected format, so it was left untouched. Open Codex's Keyboard Shortcuts and set the bindings there instead.`,
      path,
      entries: []
    }
  }

  const plan = planCodexKeymap(current, managed)
  if (plan.conflicts.length > 0) {
    return {
      status: 'conflict',
      message: plan.conflicts
        .map(
          (entry) =>
            `${entry.accelerator} is already assigned to ${entry.heldBy} in your Codex shortcuts. Clear it there, or change ${entry.title} to a different key.`
        )
        .join(' '),
      path,
      entries: plan.entries
    }
  }

  if (!plan.changed || plan.bindings === null) {
    return {
      status: 'unchanged',
      message: `Codex already has ${describe(plan.entries)}.`,
      path,
      entries: plan.entries
    }
  }

  let backupPath: string | undefined
  try {
    await mkdir(dirname(path), { recursive: true })
    // Only back up a file that exists and has content worth restoring.
    if (raw.trim().length > 0) {
      backupPath = `${path}${BACKUP_SUFFIX}`
      // The backup exists to restore what Codex had *before* Codex Controller ever
      // touched it. Copying over it on every apply meant the second apply
      // replaced the user's original keymap with our own output, and the thing
      // the backup was for was gone. `COPYFILE_EXCL` fails rather than
      // overwrite, so the first one wins for good.
      try {
        await copyFile(path, backupPath, constants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    // Write-then-rename so Codex can never observe a half-written keymap.
    const temporary = `${path}.codex-controller-tmp`
    await writeFile(temporary, serializeCodexKeymap(plan.bindings), 'utf8')
    await rename(temporary, path)
  } catch (error) {
    return {
      status: 'failed',
      message: `Could not update ${path}: ${(error as Error).message}`,
      path,
      entries: plan.entries
    }
  }

  const applied = plan.entries.filter((entry) => entry.state === 'set')
  const replaced = applied.filter((entry) => entry.previous !== null)
  return {
    status: 'applied',
    message: `Set ${describe(applied)} in Codex.${
      replaced.length > 0
        ? ` Replaced ${replaced.map((entry) => `${entry.title}'s previous ${entry.previous}`).join(' and ')}.`
        : ''
    } Restart Codex if the shortcut does not take effect immediately.`,
    path,
    backupPath,
    entries: plan.entries
  }
}
