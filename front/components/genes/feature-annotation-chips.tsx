'use client'

import { useMemo } from 'react'
import { filterKey, type UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import {
  featureQueryChips,
  type FeatureQueryChipKind,
} from '@/lib/feature-query-chips'

const KIND_STYLES: Record<FeatureQueryChipKind, string> = {
  alias:
    'border-border bg-muted/60 text-foreground hover:bg-muted',
  xref: 'border-border bg-background text-foreground hover:bg-muted/80',
  ontology:
    'border-[var(--scope-genomicFeature-border)]/40 bg-[var(--scope-genomicFeature-bg)] text-[var(--scope-genomicFeature-text)] hover:opacity-90',
}

type FeatureAnnotationChipsProps = {
  feature: Feature
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  className?: string
  /** When set, only show chips of these kinds (e.g. aliases only under Aliases). */
  kinds?: FeatureQueryChipKind[]
}

export function FeatureAnnotationChips({
  feature,
  activeFilters,
  onAddFilter,
  className = '',
  kinds,
}: FeatureAnnotationChipsProps) {
  const chips = useMemo(() => {
    const all = featureQueryChips(feature)
    if (!kinds?.length) return all
    const allowed = new Set(kinds)
    return all.filter((c) => allowed.has(c.kind))
  }, [feature, kinds])
  const activeKeys = useMemo(
    () => new Set(activeFilters.map((f) => filterKey(f))),
    [activeFilters]
  )

  if (chips.length === 0) return null

  return (
    <div
      className={`flex flex-wrap gap-1 ${className}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {chips.map((chip) => {
        const inQuery = activeKeys.has(filterKey(chip.filter))
        return (
          <button
            key={chip.key}
            type="button"
            title={inQuery ? `${chip.tooltip} · already in query` : chip.tooltip}
            disabled={inQuery}
            className={`max-w-[12rem] truncate rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-45 ${KIND_STYLES[chip.kind]}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!inQuery) onAddFilter(chip.filter)
            }}
          >
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
