import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import { mappingLayerIds, mappingLayerLabels, type MappingLayer } from '@shared/contracts'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const layerOrder: readonly MappingLayer[] = mappingLayerIds

/**
 * `activeLayer` decides which binding a controller press resolves to and which
 * binding the editor opens when a part is clicked. Hardware `layerShift`
 * bindings move it while a button is held. It was previously invisible, so the
 * same click on the same control could open different bindings with no
 * explanation. Showing it makes the editing context legible and switchable.
 */
export function LayerSwitcher({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const counts = useMemo(() => {
    const totals = new Map<MappingLayer, number>()
    for (const binding of model.activeProfile.bindings) {
      if (binding.action.type === 'none') continue
      totals.set(binding.layer, (totals.get(binding.layer) ?? 0) + 1)
    }
    return totals
  }, [model.activeProfile.bindings])

  // A layer with no bindings is noise. Base is always offered as the fallback
  // every unmatched gesture resolves to, and the live layer is always shown even
  // when empty — a hardware layer-shift can activate a layer that has no
  // bindings yet, and hiding it would leave nothing selected.
  const layers = layerOrder.filter(
    (layer) => layer === 'base' || layer === model.activeLayer || (counts.get(layer) ?? 0) > 0
  )

  return (
    <div className="layer-switcher" role="group" aria-label="Mapping layer">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="layer-switcher-icon" aria-hidden="true">
            <Layers size={13} strokeWidth={2} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          The layer a controller press resolves in. Hold a layer-shift control to switch
          temporarily.
        </TooltipContent>
      </Tooltip>
      {layers.map((layer) => {
        const selected = model.activeLayer === layer
        const count = counts.get(layer) ?? 0
        return (
          <button
            key={layer}
            type="button"
            className="layer-chip"
            data-selected={selected}
            aria-pressed={selected}
            aria-label={`${mappingLayerLabels[layer]} layer, ${count} mapping${count === 1 ? '' : 's'}`}
            onClick={() => model.setActiveLayer(layer)}
          >
            {mappingLayerLabels[layer]}
            <span className="layer-chip-count">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
