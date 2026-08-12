export interface ControllerPartVisualState {
  activeValue: number
  selected: boolean
  focused: boolean
  hovered: boolean
}

export interface ControllerPartEmphasisState extends ControllerPartVisualState {
  /** The control has an enabled, non-empty binding in the layer being edited. */
  mapped: boolean
  /** Another binding claims the same gesture in the same layer. */
  conflicting: boolean
}

/**
 * Drives the material tint, which reads as "this control is being pressed right
 * now". Selection contributes only a little: the shell is white, so a colour
 * lerp toward blue is a weak signal there and is not what selection relies on.
 */
export const controllerPartHighlight = ({
  activeValue,
  selected,
  focused,
  hovered
}: ControllerPartVisualState): number =>
  Math.max(
    Math.min(1, activeValue * 1.5),
    selected ? 0.38 : focused ? 0.64 : hovered ? 0.3 : 0
  )

export const controllerPartIsPressed = (activeValue: number): boolean => activeValue >= 0.5

export type ControllerPartTone = 'none' | 'mapped' | 'conflict' | 'selected' | 'pointer'

/**
 * Which colour the halo takes. Selection outranks everything so the part you
 * picked is never ambiguous, and a conflict outranks a plain mapping so a
 * problem is visible without opening the mappings list.
 */
export const controllerPartTone = ({
  selected,
  focused,
  hovered,
  mapped,
  conflicting
}: ControllerPartEmphasisState): ControllerPartTone => {
  if (selected) return 'selected'
  if (focused || hovered) return 'pointer'
  if (conflicting) return 'conflict'
  if (mapped) return 'mapped'
  return 'none'
}

/**
 * Halo opacity. The halo is an additively blended back-side rim, so this is the
 * signal that actually survives against a white controller shell — the previous
 * build drove selection at roughly 0.12 opacity, which was invisible at normal
 * viewing size.
 */
export const controllerPartEmphasis = (state: ControllerPartEmphasisState): number => {
  const pressed = Math.min(1, state.activeValue * 1.5) * 0.3
  switch (controllerPartTone(state)) {
    case 'selected':
      return Math.min(1, 0.86 + pressed)
    case 'pointer':
      return Math.min(1, 0.6 + pressed)
    case 'conflict':
      return Math.min(1, 0.44 + pressed)
    case 'mapped':
      return Math.min(1, 0.3 + pressed)
    default:
      return pressed
  }
}

/** Rim thickness. Selection gets the widest rim so it reads at a glance. */
export const controllerPartHaloScale = (tone: ControllerPartTone): number => {
  switch (tone) {
    case 'selected':
      return 1.15
    case 'pointer':
      return 1.11
    case 'conflict':
      return 1.09
    default:
      return 1.055
  }
}
