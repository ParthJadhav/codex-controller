import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Plus, RotateCcw, Search, Trash2, Upload } from 'lucide-react'
import {
  gestureLabels,
  inputDisplayNames,
  mappingLayerIds,
  mappingLayerLabels,
  type MappingLayer
} from '@shared/contracts'
import { profileLimits } from '@shared/profileLimits'
import { ConfirmDialog } from './ConfirmDialog'
import { MappingInspector } from './MappingInspector'
import type { ControllerAppModel } from '../hooks/useControllerApp'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const layers: readonly MappingLayer[] = mappingLayerIds

export function MappingsView({ model }: { model: ControllerAppModel }): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)

  const conflictIds = useMemo(() => {
    const ids = new Set<string>()
    for (const group of model.conflicts) for (const binding of group) ids.add(binding.id)
    return ids
  }, [model.conflicts])

  const groups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return layers.map((layer) => ({
      layer,
      bindings: model.activeProfile.bindings.filter(
        (binding) =>
          binding.layer === layer &&
          (!query ||
            inputDisplayNames[binding.input].toLocaleLowerCase().includes(query) ||
            binding.action.title.toLocaleLowerCase().includes(query) ||
            // Both the id and the label: the row shows "Rotate clockwise", so a
            // search for "rotate" has to find it, and a search for the id the
            // profile file uses has to keep working.
            binding.gesture.toLocaleLowerCase().includes(query) ||
            gestureLabels[binding.gesture].toLocaleLowerCase().includes(query))
      )
    }))
  }, [model.activeProfile.bindings, search])

  const total = model.activeProfile.bindings.length
  const profileCount = model.library.profiles.length
  // Every profile, not the one on screen: reset replaces the whole library.
  const libraryMappingCount = model.library.profiles.reduce(
    (count, profile) => count + profile.bindings.length,
    0
  )
  const empty = groups.every((group) => group.bindings.length === 0)
  const searching = search.trim().length > 0

  return (
    <div className="mappings-view">
      <section className="mapping-browser" aria-label="Mapping browser">
        <div className="mapping-browser-head">
          <div className="mapping-search">
            <Search size={14} strokeWidth={2} aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={`Search ${total} mappings`}
              aria-label="Search mappings"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={model.addBinding}
                aria-label="Add mapping"
                disabled={model.activeProfile.bindings.length >= profileLimits.bindings}
              >
                <Plus size={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add mapping</TooltipContent>
          </Tooltip>
        </div>

        {model.conflicts.length > 0 && (
          <div className="mapping-conflict-banner" role="status">
            <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            <span>
              {model.conflicts.length} conflict{model.conflicts.length === 1 ? '' : 's'}: the same
              gesture is mapped twice in one layer.
            </span>
          </div>
        )}

        <div className="mapping-list">
          {groups.map(({ layer, bindings }) =>
            bindings.length > 0 ? (
              <section className="mapping-group" key={layer}>
                <h2>
                  {mappingLayerLabels[layer]}
                  <span>{bindings.length}</span>
                </h2>
                {bindings.map((binding) => (
                  <button
                    type="button"
                    className="mapping-row"
                    data-selected={model.selectedBinding?.id === binding.id}
                    data-disabled={!binding.isEnabled}
                    data-conflict={conflictIds.has(binding.id)}
                    key={binding.id}
                    onClick={() => model.selectBinding(binding)}
                  >
                    <span className="mapping-control">{inputDisplayNames[binding.input]}</span>
                    <span className="mapping-copy">
                      <strong>{binding.action.title}</strong>
                      <small>{gestureLabels[binding.gesture]}</small>
                    </span>
                    {conflictIds.has(binding.id) ? (
                      <AlertTriangle
                        className="mapping-flag"
                        size={13}
                        aria-label="Conflicting mapping"
                      />
                    ) : !binding.isEnabled ? (
                      <span className="mapping-flag mapping-flag-off" aria-label="Disabled" />
                    ) : (
                      <span className="mapping-flag" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </section>
            ) : null
          )}
          {empty &&
            /*
              An empty library is not a failed search. Blaming the search box for
              a profile that has no mappings — the state right after "delete the
              last one" — told the user to clear a query that was never there.
            */
            (searching ? (
              <div className="mapping-empty">
                <Search size={20} strokeWidth={1.6} aria-hidden="true" />
                <p>No mappings match “{search}”.</p>
              </div>
            ) : (
              <div className="mapping-empty">
                <Plus size={20} strokeWidth={1.6} aria-hidden="true" />
                <p>No mappings yet. Add one to give a control something to do.</p>
              </div>
            ))}
        </div>

        <div className="mapping-browser-foot">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={model.deleteSelectedBinding}
            disabled={!model.selectedBinding}
          >
            <Trash2 size={13} aria-hidden="true" />
            Delete
          </Button>
          <span className="spacer" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void model.importLibrary()}
                aria-label="Import profile"
                disabled={model.library.profiles.length >= profileLimits.profiles}
              >
                <Upload size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import profile</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void model.exportLibrary()}
                aria-label="Export profile"
              >
                <Download size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export profile</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setConfirmingReset(true)}
                aria-label="Reset mappings to defaults"
              >
                <RotateCcw size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to defaults</TooltipContent>
          </Tooltip>
        </div>
      </section>

      <MappingInspector model={model} showInputPicker />

      {/*
        Reset does not restore "this list" — it replaces the entire library with
        one freshly generated default profile, so every other profile goes with
        it. Naming the count is the difference between an undo-able-feeling
        button and the one that deleted someone's second controller setup.
      */}
      <ConfirmDialog
        open={confirmingReset}
        title="Reset all mappings to defaults?"
        description={`This removes ${profileCount} ${
          profileCount === 1 ? 'profile' : 'profiles'
        } and ${libraryMappingCount} ${
          libraryMappingCount === 1 ? 'mapping' : 'mappings'
        }, and replaces them with the shipped defaults. Saved automatically, and it cannot be undone.`}
        confirmLabel="Reset to defaults"
        onConfirm={() => {
          setConfirmingReset(false)
          model.resetToDefaults()
        }}
        onCancel={() => setConfirmingReset(false)}
      />
    </div>
  )
}
