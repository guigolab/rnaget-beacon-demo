'use client'

import { ChevronDown } from 'lucide-react'
import { useMemo } from 'react'
import { filterKey, type UiFilter } from '@/lib/beacon'
import type { BeaconScope, NamespaceScopeGroup } from '@/lib/scope-theme'

const OPEN_BORDER_CLASS: Record<BeaconScope, string> = {
  biosample: 'open:border-[var(--scope-biosample-border)]',
  genomicFeature: 'open:border-[var(--scope-genomicFeature-border)]',
  matrix: 'open:border-[var(--scope-matrix-border)]',
}

type NamespaceTermCollapseProps = {
  group: NamespaceScopeGroup
  scope: BeaconScope
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  resourceName?: string
}

export function NamespaceTermCollapse({
  group,
  scope,
  activeFilters,
  onAddFilter,
  resourceName,
}: NamespaceTermCollapseProps) {
  const activeKeys = useMemo(
    () => new Set(activeFilters.map((f) => filterKey(f))),
    [activeFilters]
  )

  const sortedTerms = useMemo(
    () =>
      [...group.terms].sort((a, b) =>
        (a.label ?? a.id).localeCompare(b.label ?? b.id)
      ),
    [group.terms]
  )

  function selectTerm(term: { id: string; label?: string }) {
    onAddFilter({ kind: 'ontology', id: term.id, label: term.label })
  }

  const prefix = (group.namespaceType || 'unknown').toUpperCase()
  const subtitle = resourceName ?? group.namespaceLabel

  return (
    <details
      className={`group min-w-0 overflow-hidden rounded-md border border-border bg-muted/30 open:bg-muted/40 ${OPEN_BORDER_CLASS[scope]}`}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] font-semibold text-foreground">{prefix}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            {subtitle}
            <span className="text-muted-foreground/80">
              {' · '}
              {group.count} term{group.count === 1 ? '' : 's'}
            </span>
          </p>
        </div>
        <ChevronDown
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ul className="max-h-52 overflow-x-hidden overflow-y-auto overscroll-contain border-t border-border/80 px-2.5 pb-2 pt-0.5 [scrollbar-width:thin]">
        {sortedTerms.map((term) => {
          const filter: UiFilter = {
            kind: 'ontology',
            id: term.id,
            label: term.label,
          }
          const selected = activeKeys.has(filterKey(filter))
          const label = term.label ?? term.id
          return (
            <li key={term.id} className="min-w-0">
              <button
                type="button"
                disabled={selected}
                title={
                  selected ? `${label} (${term.id}) · in query` : `${label} (${term.id})`
                }
                className="block w-full min-w-0 py-1.5 text-left hover:bg-background/70 disabled:cursor-default disabled:opacity-50"
                onClick={() => selectTerm(term)}
              >
                <span className="block text-xs font-medium leading-snug text-foreground [overflow-wrap:anywhere]">
                  {label}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] leading-tight text-muted-foreground [overflow-wrap:anywhere]">
                  {term.id}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
