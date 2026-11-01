'use client'

import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GeneFilterProbe } from '@/hooks/use-gene-filter-probe'
import { dedupeFilters, filterKey, tokenToFilter, type UiFilter } from '@/lib/beacon'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import { catalogLabelById, filterChipDisplay } from '@/lib/gene-filter-labels'
import { geneLensQueryExamples } from '@/lib/gene-lens'

function isHiddenResourceTerm(id: string): boolean {
  const lower = id.toLowerCase()
  return lower.startsWith('resource:gencode') || lower.startsWith('resource:ncbigene')
}

function borderClass(probe: GeneFilterProbe, hasFilters: boolean): string {
  if (!hasFilters || probe.loading || probe.error) {
    return 'border-border focus-within:ring-ring/30'
  }
  if (probe.exists === true) {
    return 'border-emerald-600/70 focus-within:ring-emerald-500/25'
  }
  if (probe.exists === false) {
    return 'border-red-500/70 focus-within:ring-red-500/25'
  }
  return 'border-border focus-within:ring-ring/30'
}

type GeneFeatureQueryBarProps = {
  filters: UiFilter[]
  onChange: (filters: UiFilter[]) => void
  probe: GeneFilterProbe
}

export function GeneFeatureQueryBar({ filters, onChange, probe }: GeneFeatureQueryBarProps) {
  const { terms, error } = useFilteringTerms('/features/filtering_terms')
  const [text, setText] = useState('')

  const labelCatalog = useMemo(() => catalogLabelById(terms), [terms])
  const scopeIndex = useMergedFilterScopeIndex()
  const examples = useMemo(() => geneLensQueryExamples(terms), [terms])

  function add(filter: UiFilter | null) {
    if (!filter) return
    onChange(dedupeFilters([...filters, filter]))
    setText('')
  }

  function remove(filter: UiFilter) {
    onChange(filters.filter((f) => filterKey(f) !== filterKey(filter)))
  }

  function addText(raw: string) {
    const typed = tokenToFilter(raw, 'feature', scopeIndex)
    if (!typed) return
    if (typed.kind === 'ontology' || typed.kind === 'custom') {
      if (isHiddenResourceTerm(typed.id)) return
      const label = labelCatalog.get(typed.id.toLowerCase())
      add({ ...typed, label })
      return
    }
    add(typed)
  }

  function applyExample(filter: UiFilter) {
    onChange(dedupeFilters([filter]))
  }

  return (
    <div className="relative">
      <div
        className={`rounded-lg border bg-background focus-within:ring-2 ${borderClass(probe, filters.length > 0)}`}
        onClick={() => document.getElementById('gene-query-input')?.focus()}
      >
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-2 py-1.5">
          {filters.map((filter) => {
            const { text: chipText, tooltip } = filterChipDisplay(filter, labelCatalog)
            return (
              <button
                key={filterKey(filter)}
                type="button"
                title={tooltip}
                className="inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-border bg-muted/80 py-0.5 pl-2 pr-1 text-sm font-medium hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(filter)
                }}
              >
                <span className="truncate">{chipText}</span>
                <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">Remove {chipText}</span>
              </button>
            )
          })}
          <input
            id="gene-query-input"
            aria-label="Add feature filter"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addText(text)
              }
              if (e.key === 'Backspace' && !text && filters.length) {
                remove(filters[filters.length - 1])
              }
            }}
            placeholder={filters.length ? 'Add filter…' : 'Symbol, HGNC:…, SO:…, GO:…'}
            className="min-w-[10rem] flex-1 border-0 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Examples</span>
        {examples.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => applyExample(example.filter)}
            className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            {example.label}
          </button>
        ))}
      </div>

      {(error || probe.error) && (
        <p className="mt-1 text-[11px] text-muted-foreground">{error || probe.error}</p>
      )}
    </div>
  )
}
