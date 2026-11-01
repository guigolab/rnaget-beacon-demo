'use client'

import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BiosampleFilterProbe } from '@/hooks/use-biosample-filter-probe'
import {
  dedupeFilters,
  filterKey,
  tokenToFilter,
  type UiFilter,
} from '@/lib/beacon'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import { catalogLabelById, filterChipDisplay } from '@/lib/gene-filter-labels'
import { mergeSampleLensFilters, sampleLensQueryExamples } from '@/lib/sample-lens'

function borderClass(probe: BiosampleFilterProbe, hasFilters: boolean): string {
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

type BiosampleQueryBarProps = {
  filters: UiFilter[]
  onChange: (filters: UiFilter[]) => void
  probe: BiosampleFilterProbe
}

export function BiosampleQueryBar({ filters, onChange, probe }: BiosampleQueryBarProps) {
  const { terms, error } = useFilteringTerms('/biosamples/filtering_terms')
  const [text, setText] = useState('')

  const labelCatalog = useMemo(() => catalogLabelById(terms), [terms])
  const examples = useMemo(() => sampleLensQueryExamples(terms), [terms])

  const alphanumericTerms = useMemo(
    () =>
      terms.filter(
        (t) =>
          t.type === 'alphanumeric' &&
          (t.scopes?.includes('biosample') ?? false) &&
          t.id !== 'sex'
      ),
    [terms]
  )

  function applyFilters(next: UiFilter[]) {
    onChange(dedupeFilters(next))
    setText('')
  }

  function add(filter: UiFilter | null) {
    if (!filter) return
    applyFilters(mergeSampleLensFilters(filters, filter))
  }

  function remove(filter: UiFilter) {
    onChange(filters.filter((f) => filterKey(f) !== filterKey(filter)))
  }

  function addText(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return

    const typed = tokenToFilter(trimmed, 'biosample')
    if (typed && (typed.kind === 'ontology' || typed.kind === 'custom')) {
      const match = terms.find((term) => term.id.toLowerCase() === typed.id.toLowerCase())
      add({ ...typed, label: match?.label ?? typed.label })
      return
    }
    if (typed) {
      add(typed)
      return
    }

    const sexTerm = terms.find((t) => t.id === 'sex')
    const sex = sexTerm?.values?.find(
      (value) => value.toLowerCase() === trimmed.toLowerCase()
    )
    if (sex) {
      add({ kind: 'sex', value: sex })
      return
    }

    for (const term of alphanumericTerms) {
      const hit = term.values?.find(
        (value) => value.toLowerCase() === trimmed.toLowerCase()
      )
      if (hit) {
        add({
          kind: 'alphanumeric',
          id: term.id,
          value: hit,
          label: `${term.label ?? term.id} = ${hit}`,
        })
        return
      }
    }
  }

  function applyExample(filter: UiFilter) {
    applyFilters([filter])
  }

  return (
    <div className="relative">
      <div
        className={`rounded-lg border bg-background focus-within:ring-2 ${borderClass(probe, filters.length > 0)}`}
        onClick={() => document.getElementById('sample-query-input')?.focus()}
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
            id="sample-query-input"
            aria-label="Add biosample filter"
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
            placeholder={
              filters.length
                ? 'Add filter…'
                : 'Tissue, UBERON:…, EFO:…, female, GEO:sample'
            }
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
