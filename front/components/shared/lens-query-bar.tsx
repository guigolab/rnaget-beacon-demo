'use client'

import { useId, useRef, useState } from 'react'
import { FilterChipButton } from '@/components/shared/filter-chip-button'
import { filterKey, type UiFilter } from '@/lib/beacon'
import { filterChipDisplay } from '@/lib/gene-filter-labels'
import type { LensProbe } from '@/lib/lens-preview-note'

function borderClass(probe: LensProbe, hasFilters: boolean): string {
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

type LensQueryBarProps = {
  label: string
  placeholder: string
  filters: UiFilter[]
  onChange: (filters: UiFilter[]) => void
  probe: LensProbe
  examples: Array<{ label: string; filter: UiFilter }>
  labelCatalog: Map<string, string>
  resolveText: (raw: string) => UiFilter | null
  mergeAdded?: (current: UiFilter[], added: UiFilter) => UiFilter[]
  catalogError?: string
}

export function LensQueryBar({
  label,
  placeholder,
  filters,
  onChange,
  probe,
  examples,
  labelCatalog,
  resolveText,
  mergeAdded,
  catalogError,
}: LensQueryBarProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')

  function commit(filter: UiFilter | null) {
    if (!filter) return
    const next = mergeAdded ? mergeAdded(filters, filter) : [...filters, filter]
    const seen = new Set<string>()
    onChange(
      next.filter((item) => {
        const key = filterKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    )
    setText('')
  }

  function remove(filter: UiFilter) {
    const key = filterKey(filter)
    onChange(filters.filter((item) => filterKey(item) !== key))
  }

  function addText(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return
    commit(resolveText(trimmed))
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div
        className={`rounded-lg border bg-background focus-within:ring-2 ${borderClass(probe, filters.length > 0)}`}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-2 py-1.5">
          {filters.map((filter) => {
            const display = filterChipDisplay(filter, labelCatalog)
            return (
              <FilterChipButton
                key={filterKey(filter)}
                label={display.text}
                title={display.tooltip}
                onRemove={() => remove(filter)}
              />
            )
          })}
          <input
            ref={inputRef}
            id={inputId}
            aria-label={label}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addText(text)
              }
              if (event.key === 'Backspace' && !text && filters.length) {
                remove(filters[filters.length - 1])
              }
            }}
            placeholder={filters.length ? 'Add filter…' : placeholder}
            className="min-w-[10rem] flex-1 border-0 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {examples.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Examples</span>
          {examples.map((example) => (
            <button
              key={filterKey(example.filter)}
              type="button"
              onClick={() => onChange([example.filter])}
              className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {example.label}
            </button>
          ))}
        </div>
      )}

      {(catalogError || probe.error) && (
        <p className="mt-1 text-[11px] text-muted-foreground">{catalogError || probe.error}</p>
      )}
    </div>
  )
}
