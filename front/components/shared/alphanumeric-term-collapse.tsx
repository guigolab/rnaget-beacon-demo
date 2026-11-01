'use client'

import { ChevronDown } from 'lucide-react'
import { useMemo } from 'react'
import { filterKey, type FilteringTerm, type UiFilter } from '@/lib/beacon'
import type { BeaconScope } from '@/lib/scope-theme'

const OPEN_BORDER_CLASS: Record<BeaconScope, string> = {
  biosample: 'open:border-[var(--scope-biosample-border)]',
  genomicFeature: 'open:border-[var(--scope-genomicFeature-border)]',
  matrix: 'open:border-[var(--scope-matrix-border)]',
}

type AlphanumericTermCollapseProps = {
  term: FilteringTerm
  scope: BeaconScope
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
}

export function AlphanumericTermCollapse({
  term,
  scope,
  activeFilters,
  onAddFilter,
}: AlphanumericTermCollapseProps) {
  const values = useMemo(
    () => [...(term.values ?? [])].sort((a, b) => a.localeCompare(b)),
    [term.values]
  )

  const activeKeys = useMemo(
    () => new Set(activeFilters.map((f) => filterKey(f))),
    [activeFilters]
  )

  if (!values.length) return null

  function selectValue(value: string) {
    if (term.id === 'sex') {
      onAddFilter({ kind: 'sex', value })
      return
    }
    onAddFilter({
      kind: 'alphanumeric',
      id: term.id,
      value,
      label: `${term.label ?? term.id} = ${value}`,
    })
  }

  const title = term.label ?? term.id

  return (
    <details
      className={`group min-w-0 overflow-hidden rounded-md border border-border bg-muted/30 open:bg-muted/40 ${OPEN_BORDER_CLASS[scope]}`}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] font-semibold text-foreground">{title}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            {term.id}
            <span className="text-muted-foreground/80">
              {' · '}
              {values.length} value{values.length === 1 ? '' : 's'}
            </span>
          </p>
        </div>
        <ChevronDown
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ul className="max-h-52 overflow-x-hidden overflow-y-auto overscroll-contain border-t border-border/80 px-2.5 pb-2 pt-0.5 [scrollbar-width:thin]">
        {values.map((value) => {
          const filter: UiFilter =
            term.id === 'sex'
              ? { kind: 'sex', value }
              : {
                  kind: 'alphanumeric',
                  id: term.id,
                  value,
                  label: `${title} = ${value}`,
                }
          const selected = activeKeys.has(filterKey(filter))
          return (
            <li key={value} className="min-w-0">
              <button
                type="button"
                disabled={selected}
                title={selected ? `${value} · in query` : value}
                className="block w-full min-w-0 py-1.5 text-left text-xs font-medium text-foreground hover:bg-background/70 disabled:cursor-default disabled:opacity-50"
                onClick={() => selectValue(value)}
              >
                {value}
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
