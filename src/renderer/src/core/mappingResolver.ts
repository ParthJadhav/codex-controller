import type {
  ControllerBinding,
  MappingLayer,
  MappingProfile
} from '@shared/contracts'
import type { ControllerGesture } from './gestureEngine'

export const resolveBinding = (
  gesture: ControllerGesture,
  profile: MappingProfile,
  activeLayer: MappingLayer
): ControllerBinding | null => {
  const candidates = profile.bindings.filter((binding) => {
    if (!binding.isEnabled || binding.gesture !== gesture.kind) return false
    if (gesture.kind !== 'chord') return binding.input === gesture.input
    if (!binding.secondaryInput || !gesture.secondaryInput) return false
    const bindingInputs = [binding.input, binding.secondaryInput].sort().join('+')
    const gestureInputs = [gesture.input, gesture.secondaryInput].sort().join('+')
    return bindingInputs === gestureInputs
  })
  if (activeLayer !== 'base') {
    const layered = candidates.find((binding) => binding.layer === activeLayer)
    if (layered) return layered
  }
  return candidates.find((binding) => binding.layer === 'base') ?? null
}

export const mappingConflicts = (profile: MappingProfile): ControllerBinding[][] => {
  const groups = new Map<string, ControllerBinding[]>()
  for (const binding of profile.bindings.filter((value) => value.isEnabled)) {
    const inputs =
      binding.gesture === 'chord' && binding.secondaryInput
        ? [binding.input, binding.secondaryInput].sort().join('+')
        : binding.input
    const key = `${binding.layer}|${inputs}|${binding.gesture}`
    groups.set(key, [...(groups.get(key) ?? []), binding])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}
