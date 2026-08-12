import { describe, expect, it } from 'vitest'
import type { ShortcutModifier } from './contracts'
import { codexCommands } from './codexCommands'
import { createDefaultProfile } from './defaultProfile'
import {
  MICRO_PROFILE_NAME,
  createMicroCompanionProfile,
  microDialModeFromProfile,
  microDialModes,
  microRoles,
  withMicroDialMode,
  type MicroDialMode
} from './microProfile'

const allModes: MicroDialMode[] = ['reasoning', 'composer-navigation', 'conversation-scroll']

const rotationOf = (profile: ReturnType<typeof createMicroCompanionProfile>, gesture: string) =>
  profile.bindings.find(
    (entry) => entry.input === 'rightStickClick' && entry.gesture === gesture
  )

describe('createMicroCompanionProfile', () => {
  it('defaults the dial to the one mode that can run Codex’s own commands', () => {
    expect(microDialModeFromProfile(createMicroCompanionProfile())).toBe('reasoning')
  })

  it('binds six Agent slots to the six task commands Codex ships', () => {
    const profile = createMicroCompanionProfile()
    const taskCommands = [
      codexCommands.task1,
      codexCommands.task2,
      codexCommands.task3,
      codexCommands.task4,
      codexCommands.task5,
      codexCommands.task6
    ]
    for (const entry of taskCommands) {
      expect(entry.shipsDefault).toBe(true)
      const bound = profile.bindings.filter(
        (candidate) => candidate.action.shortcut?.keyCode === entry.shortcut.keyCode
      )
      expect(bound.length).toBeGreaterThan(0)
    }
  })

  it('follows Micro’s dial direction rather than the default profile’s', () => {
    // Micro treats clockwise as ArrowUp, which decreases effort. The shipped
    // default profile increases on clockwise; both are intentional.
    const micro = createMicroCompanionProfile('reasoning')
    expect(rotationOf(micro, 'rotateClockwise')?.action.title).toBe(
      codexCommands.decreaseReasoningEffort.title
    )
    expect(rotationOf(micro, 'rotateCounterClockwise')?.action.title).toBe(
      codexCommands.increaseReasoningEffort.title
    )

    const stock = createDefaultProfile()
    const stockClockwise = stock.bindings.find(
      (entry) => entry.input === 'rightStickClick' && entry.gesture === 'rotateClockwise'
    )
    expect(stockClockwise?.action.title).toBe(codexCommands.increaseReasoningEffort.title)
  })

  it('leaves the second circular gesture unmapped rather than inventing a job', () => {
    // Micro has one dial and so does this profile. Codex exposes no relative
    // model operation, so there is nothing honest for L3 rotation to do.
    const profile = createMicroCompanionProfile()
    expect(profile.bindings.filter((entry) => entry.input === 'leftStickClick')).toEqual([])
  })

  it('makes no model-cycling claim anywhere in the profile', () => {
    for (const entry of createMicroCompanionProfile().bindings) {
      expect(entry.action.title).not.toMatch(/cycl|next model|previous model/i)
    }
  })

  it('keeps arrow navigation reachable so an opened picker can be driven', () => {
    const profile = createMicroCompanionProfile()
    const arrows = profile.bindings.filter((entry) =>
      ['rightStickUp', 'rightStickDown', 'rightStickLeft', 'rightStickRight'].includes(entry.input)
    )
    expect(arrows).toHaveLength(4)
  })

  it('gives every binding a distinct input and gesture pairing', () => {
    const profile = createMicroCompanionProfile()
    const seen = new Set<string>()
    for (const entry of profile.bindings) {
      const pair = `${entry.input}:${entry.gesture}:${entry.layer}`
      expect(seen.has(pair)).toBe(false)
      seen.add(pair)
    }
  })
})

describe('withMicroDialMode', () => {
  it('round-trips every mode', () => {
    let profile = createMicroCompanionProfile()
    for (const mode of allModes) {
      profile = withMicroDialMode(profile, mode)
      expect(microDialModeFromProfile(profile)).toBe(mode)
    }
  })

  it('replaces only the two rotation bindings', () => {
    const profile = createMicroCompanionProfile('reasoning')
    const switched = withMicroDialMode(profile, 'conversation-scroll')
    const untouched = (entries: typeof profile.bindings) =>
      entries
        .filter(
          (entry) =>
            !(
              entry.input === 'rightStickClick' &&
              (entry.gesture === 'rotateClockwise' ||
                entry.gesture === 'rotateCounterClockwise')
            )
        )
        .map((entry) => `${entry.input}:${entry.gesture}:${entry.action.title}`)
        .sort()
    expect(untouched(switched.bindings)).toEqual(untouched(profile.bindings))
    expect(switched.bindings).toHaveLength(profile.bindings.length)
  })

  it('keeps a user’s edit to an unrelated binding', () => {
    const profile = createMicroCompanionProfile()
    const edited = {
      ...profile,
      bindings: profile.bindings.map((entry) =>
        entry.input === 'menu'
          ? { ...entry, action: { ...entry.action, title: 'Something the user chose' } }
          : entry
      )
    }
    const switched = withMicroDialMode(edited, 'composer-navigation')
    expect(
      switched.bindings.find((entry) => entry.input === 'menu')?.action.title
    ).toBe('Something the user chose')
  })

  it('reports an unrecognised dial as null rather than guessing a mode', () => {
    const profile = createMicroCompanionProfile()
    const rewritten = {
      ...profile,
      bindings: profile.bindings.map((entry) =>
        entry.input === 'rightStickClick' && entry.gesture === 'rotateClockwise'
          ? { ...entry, action: { type: 'none' as const, title: 'Unassigned' } }
          : entry
      )
    }
    expect(microDialModeFromProfile(rewritten)).toBeNull()
  })

  /**
   * The mode used to be read off the *number* of modifiers, so any two-modifier
   * shortcut on the same key counted as reasoning mode — including ⌘⌥, which
   * Codex does not listen for. The picker then showed a mode the controller
   * would not perform.
   */
  it('rejects the same key held with different modifiers', () => {
    const profile = createMicroCompanionProfile('reasoning')
    const rewritten = {
      ...profile,
      bindings: profile.bindings.map((entry) =>
        entry.input === 'rightStickClick' && entry.gesture === 'rotateClockwise'
          ? {
              ...entry,
              action: {
                ...entry.action,
                shortcut: {
                  ...entry.action.shortcut!,
                  modifiers: ['command', 'option'] as ShortcutModifier[]
                }
              }
            }
          : entry
      )
    }
    expect(microDialModeFromProfile(rewritten)).toBeNull()
  })

  it('accepts the right modifiers in any order', () => {
    const profile = createMicroCompanionProfile('reasoning')
    const reordered = {
      ...profile,
      bindings: profile.bindings.map((entry) =>
        entry.input === 'rightStickClick' && entry.gesture === 'rotateClockwise'
          ? {
              ...entry,
              action: {
                ...entry.action,
                shortcut: {
                  ...entry.action.shortcut!,
                  modifiers: [...entry.action.shortcut!.modifiers].reverse()
                }
              }
            }
          : entry
      )
    }
    expect(microDialModeFromProfile(reordered)).toBe('reasoning')
  })

  it('rejects a bare key where the mode needs modifiers', () => {
    const profile = createMicroCompanionProfile('reasoning')
    const stripped = {
      ...profile,
      bindings: profile.bindings.map((entry) =>
        entry.input === 'rightStickClick' && entry.gesture === 'rotateClockwise'
          ? {
              ...entry,
              action: {
                ...entry.action,
                shortcut: { ...entry.action.shortcut!, modifiers: [] as ShortcutModifier[] }
              }
            }
          : entry
      )
    }
    expect(microDialModeFromProfile(stripped)).toBeNull()
  })
})

describe('micro parity labelling', () => {
  it('describes every dial mode', () => {
    expect(microDialModes.map((mode) => mode.id).sort()).toEqual([...allModes].sort())
  })

  it('labels the six status lights as something the hardware cannot do', () => {
    const lights = microRoles.find((role) => role.micro === 'Six status lights')
    expect(lights?.parity).toBe('approximate')
  })

  it('does not label the Agent slots as exact', () => {
    // They select the Nth task; they do not reproduce Micro's assignable slots.
    const agents = microRoles.find((role) => role.micro === 'Six Agent keys')
    expect(agents?.parity).not.toBe('exact')
  })

  it('gives every role a parity label', () => {
    for (const role of microRoles) {
      expect(['exact', 'setup', 'approximate']).toContain(role.parity)
    }
  })
})

describe('the shipped default profile', () => {
  it('is untouched by the companion profile existing', () => {
    const stock = createDefaultProfile()
    expect(stock.name).toBe('Codex')
    expect(stock.name).not.toBe(MICRO_PROFILE_NAME)
    // The stock profile leaves the D-pad on arrows; only the companion
    // profile reallocates it to task slots.
    const dpadUp = stock.bindings.find((entry) => entry.input === 'dpadUp')
    expect(dpadUp?.action.title).toBe('Arrow up')
  })
})
