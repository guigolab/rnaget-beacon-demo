'use client'

import { useMemo } from 'react'
import {
  FEATURE_BIOTYPE_FAMILY_ID,
  filterKey,
  type UiFilter,
} from '@/lib/beacon'
import type { FilteringTerm } from '@/lib/beacon/types'

const BIOTYPE_FAMILY_LABELS: Record<string, string> = {
  protein_coding: 'Protein-coding',
  lncRNA: 'Long non-coding RNA',
  pseudogene: 'Pseudogene',
  sncRNA: 'Small non-coding RNA',
  other: 'Other feature classes',
}

type FamilyValue = { value: string; label: string }

function collectBiotypeFamilies(catalogTerms: FilteringTerm[]): FamilyValue[] {
  const term = catalogTerms.find(
    (t) =>
      t.id?.trim() === FEATURE_BIOTYPE_FAMILY_ID &&
      t.type === 'alphanumeric' &&
      (!t.scopes || t.scopes.includes('genomicFeature'))
  )
  if (!term?.values?.length) return []
  return [...term.values]
    .map((value) => ({
      value,
      label: BIOTYPE_FAMILY_LABELS[value] ?? value,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
}

type MatrixBiotypeFamilyChipsProps = {
  catalogTerms: FilteringTerm[]
  activeFilters: UiFilter[]
  onToggle: (filter: UiFilter) => void
  loading?: boolean
}

/** Coarse feature-class rollups (protein-coding, lncRNA, …) for one matrix. */
export function MatrixBiotypeFamilyChips({
  catalogTerms,
  activeFilters,
  onToggle,
  loading = false,
}: MatrixBiotypeFamilyChipsProps) {
  const terms = useMemo(
    () => collectBiotypeFamilies(catalogTerms),
    [catalogTerms]
  )

  const activeKeys = useMemo(
    () => new Set(activeFilters.map((filter) => filterKey(filter))),
    [activeFilters]
  )

  if (!loading && terms.length === 0) return null

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">Gene type</p>
      {loading ? (
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {terms.map((term) => {
            const filter: UiFilter = {
              kind: 'alphanumeric',
              id: FEATURE_BIOTYPE_FAMILY_ID,
              value: term.value,
              label: term.label,
            }
            const selected = activeKeys.has(filterKey(filter))
            return (
              <li key={term.value}>
                <button
                  type="button"
                  aria-pressed={selected}
                  title={`${FEATURE_BIOTYPE_FAMILY_ID}=${term.value}`}
                  onClick={() => onToggle(filter)}
                  className={
                    selected
                      ? 'rounded-md border border-[var(--scope-genomicFeature-border)] bg-[var(--scope-genomicFeature-bg,hsl(var(--muted)))] px-2 py-0.5 text-[11px] text-foreground'
                      : 'rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                  }
                >
                  {term.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
