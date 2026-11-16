'use client'

import { Popover } from '@base-ui/react/popover'
import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { filterKey, type UiFilter } from '@/lib/beacon'
import { filterTypeChipStyle } from '@/lib/filter-type-theme'
import type { FilterGroup } from '@/lib/matrix-filter-groups'
import { cn } from '@/lib/utils'

type FilterGroupPopoverProps = {
  group: FilterGroup
  activeFilters: UiFilter[]
  onAdd: (filter: UiFilter) => void
}

/** One filter group as a chip; opens a short list of values to add. */
export function FilterGroupPopover({ group, activeFilters, onAdd }: FilterGroupPopoverProps) {
  const [query, setQuery] = useState('')
  const activeKeys = useMemo(
    () => new Set(activeFilters.map((filter) => filterKey(filter))),
    [activeFilters]
  )
  const selectedCount = group.options.filter((option) =>
    activeKeys.has(filterKey(option.filter))
  ).length
  const q = query.trim().toLowerCase()
  const options = q
    ? group.options.filter((option) =>
        `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(q)
      )
    : group.options

  return (
    <Popover.Root onOpenChange={(open) => !open && setQuery('')}>
      <Popover.Trigger
        type="button"
        title={group.hint}
        style={filterTypeChipStyle(group.type)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] hover:brightness-95',
          selectedCount > 0 && 'font-semibold'
        )}
      >
        {group.label}
        {selectedCount > 0 && (
          <span className="rounded bg-foreground/10 px-1 tabular-nums">{selectedCount}</span>
        )}
        <ChevronDown className="size-3" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-[200]">
          <Popover.Popup className="z-[200] w-[min(100vw-2rem,19rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
            <div className="border-b border-border px-3 py-2">
              <Popover.Title className="text-xs font-semibold text-foreground">
                {group.label}
              </Popover.Title>
              <p className="text-[11px] text-muted-foreground">{group.hint}</p>
            </div>
            {group.searchable && (
              <div className="px-2 pt-2">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${group.options.length.toLocaleString()}…`}
                  aria-label={`Search ${group.label}`}
                  className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:border-ring"
                />
              </div>
            )}
            <ul className="max-h-64 overflow-y-auto p-1">
              {options.length === 0 && (
                <li className="px-2.5 py-2 text-xs text-muted-foreground">No matches.</li>
              )}
              {options.map((option) => {
                const selected = activeKeys.has(filterKey(option.filter))
                return (
                  <li key={option.key}>
                    <button
                      type="button"
                      disabled={selected}
                      title={selected ? `${option.label} · in query` : option.label}
                      className="flex w-full items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-muted/70 disabled:cursor-default disabled:opacity-50"
                      onClick={() => onAdd(option.filter)}
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
                      {option.detail && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {option.detail}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
