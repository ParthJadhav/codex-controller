import type {
  ControllerBinding,
  MappingLayer,
  MappingProfile
} from '@shared/contracts'
import type { ControllerGesture } from './gestureEngine'
import { resolveBinding } from './mappingResolver'

const gestureIdentity = (binding: ControllerBinding): string => {
  const inputs =
    binding.gesture === 'chord' && binding.secondaryInput
      ? [binding.input, binding.secondaryInput].sort().join('+')
      : binding.input
  return `${binding.gesture}|${inputs}`
}

const gestureFor = (binding: ControllerBinding): ControllerGesture => ({
  input: binding.input,
  secondaryInput: binding.secondaryInput,
  kind: binding.gesture,
  timestamp: 0
})

/**
 * The bindings the runtime can actually resolve in a layer, including Base
 * fallback and enabled `none` bindings that deliberately mask that fallback.
 */
export const effectiveBindingsForLayer = (
  profile: MappingProfile,
  layer: MappingLayer
): ControllerBinding[] => {
  const representatives = new Map<string, ControllerBinding>()
  for (const binding of profile.bindings) {
    if (!binding.isEnabled) continue
    if (binding.layer !== layer && binding.layer !== 'base') continue
    const key = gestureIdentity(binding)
    if (!representatives.has(key)) representatives.set(key, binding)
  }

  const resolved = new Map<string, ControllerBinding>()
  for (const binding of representatives.values()) {
    const effective = resolveBinding(gestureFor(binding), profile, layer)
    if (effective) resolved.set(effective.id, effective)
  }
  return [...resolved.values()]
}

/**
 * A conflict matters on the stage only if runtime resolution would select one
 * of that group's members. This includes a Base conflict used as fallback, but
 * excludes Base groups masked by an active-layer mapping (including `none`).
 */
export const effectiveConflictGroupsForLayer = (
  profile: MappingProfile,
  layer: MappingLayer,
  groups: readonly ControllerBinding[][]
): ControllerBinding[][] =>
  groups.filter((group) => {
    const representative = group[0]
    if (!representative) return false
    const effective = resolveBinding(gestureFor(representative), profile, layer)
    return Boolean(effective && group.some((binding) => binding.id === effective.id))
  })
