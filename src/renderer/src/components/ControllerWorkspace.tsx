import { useMemo, useState } from 'react'
import {
  gestureLabels,
  inputDisplayNames,
  type ControllerBinding,
  type ControllerInputId
} from '@shared/contracts'
import { DualSenseScene } from './DualSenseScene'
import { MappingInspector } from './MappingInspector'
import { LayerSwitcher } from './LayerSwitcher'
import { physicalInput } from '../core/controllerSurfaces'
import {
  effectiveBindingsForLayer,
  effectiveConflictGroupsForLayer
} from '../core/mappingPresentation'
import type { ControllerAppModel } from '../hooks/useControllerApp'

/**
 * Names the control the pointer or the selection is on, and what it does in the
 * layer being edited. Without it the 3D stage gives no confirmation that the
 * part you clicked is the part the editor opened.
 */
function StageCaption({
  model,
  hovered,
  bindings
}: {
  model: ControllerAppModel
  hovered: ControllerInputId | null
  bindings: readonly ControllerBinding[]
}): React.JSX.Element {
  const input = hovered ?? model.selectedInput
  if (!input) {
    return (
      <div className="stage-caption" data-empty="true">
        <span>Select a control on the DualSense to edit what it does</span>
      </div>
    )
  }

  const physical = physicalInput(input)
  const candidates = bindings.filter(
    (candidate) =>
      physicalInput(candidate.input) === physical &&
      candidate.action.type !== 'none'
  )
  const binding = candidates[0]

  return (
    <div className="stage-caption" data-preview={hovered !== null}>
      <strong>{inputDisplayNames[input]}</strong>
      {binding ? (
        <span className="stage-caption-action">
          <span className="stage-caption-gesture">{gestureLabels[binding.gesture]}</span>
          {binding.action.title}
        </span>
      ) : (
        <span className="stage-caption-action stage-caption-unmapped">Not mapped</span>
      )}
    </div>
  )
}

export function ControllerWorkspace({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const [hovered, setHovered] = useState<ControllerInputId | null>(null)
  const effectiveBindings = useMemo(
    () => effectiveBindingsForLayer(model.activeProfile, model.activeLayer),
    [model.activeLayer, model.activeProfile]
  )

  const mappedInputs = useMemo(() => {
    const mapped = new Set<ControllerInputId>()
    for (const binding of effectiveBindings) {
      if (binding.action.type === 'none') continue
      mapped.add(physicalInput(binding.input))
    }
    return mapped
  }, [effectiveBindings])

  const conflictInputs = useMemo(() => {
    const conflicted = new Set<ControllerInputId>()
    const groups = effectiveConflictGroupsForLayer(
      model.activeProfile,
      model.activeLayer,
      model.conflicts
    )
    for (const group of groups) {
      for (const binding of group) {
        conflicted.add(physicalInput(binding.input))
        if (binding.secondaryInput) conflicted.add(physicalInput(binding.secondaryInput))
      }
    }
    return conflicted
  }, [model.activeLayer, model.activeProfile, model.conflicts])

  return (
    <div className="controller-workspace">
      <section className="controller-stage" aria-label="Interactive DualSense controller">
        <DualSenseScene
          selectedInput={model.selectedInput}
          activeValuesRef={model.controllerActiveValuesRef}
          subscribeActiveValues={model.subscribeActiveValues}
          availableInputs={model.allInputs}
          mappedInputs={mappedInputs}
          conflictInputs={conflictInputs}
          onSelect={model.selectInput}
          onDeselect={model.deselectInput}
          onHover={setHovered}
        />
        <LayerSwitcher model={model} />
        <StageCaption model={model} hovered={hovered} bindings={effectiveBindings} />
      </section>
      <MappingInspector model={model} />
    </div>
  )
}
