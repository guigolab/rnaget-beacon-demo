'use client'

import { useMemo, useState } from 'react'
import {
  dedupeFilters,
  tokenToFilter,
  type FilteringTerm,
  type UiFilter,
} from '@/lib/beacon'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'

function termsPath(scope: 'feature' | 'biosample' | 'both') {
  if (scope === 'feature') return '/features/filtering_terms'
  if (scope === 'biosample') return '/biosamples/filtering_terms'
  return '/filtering_terms'
}

function termApplies(term: FilteringTerm, scope: 'feature' | 'biosample' | 'both') {
  if (scope === 'both') return true
  const scopes = term.scopes ?? []
  if (scope === 'feature') return scopes.includes('genomicFeature') || scopes.includes('feature')
  return scopes.includes('biosample')
}

export function FilterBuilder({
  scope,
  filters,
  onChange,
  hideResourceTerms = false,
}: {
  scope: 'feature' | 'biosample' | 'both'
  filters: UiFilter[]
  onChange: (filters: UiFilter[]) => void
  hideResourceTerms?: boolean
}) {
  const { terms, error, loading } = useFilteringTerms(termsPath(scope))
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const applicable = useMemo(
    () => terms.filter((term) => termApplies(term, scope)),
    [terms, scope]
  )
  const query = text.trim().toLowerCase()
  const suggestions = useMemo(() => {
    const pool = applicable.filter((term) => {
      if (term.type === 'alphanumeric') return false
      if (hideResourceTerms && term.id.startsWith('resource:')) return false
      return true
    })
    if (!query) return pool.slice(0, 8)
    return pool
      .filter((term) => {
        const hay = `${term.label ?? ''} ${term.id} ${term.type ?? ''}`.toLowerCase()
        return hay.includes(query)
      })
      .slice(0, 8)
  }, [applicable, hideResourceTerms, query])
  const sexTerm = applicable.find((term) => term.id === 'sex')
  const customTerms = applicable.filter((term) => {
    if (term.type !== 'custom') return false
    if (hideResourceTerms && term.id.startsWith('resource:')) return false
    return true
  })

  function add(filter: UiFilter | null) {
    if (!filter) return
    if (filter.kind === 'sex') {
      onChange(dedupeFilters([...filters.filter((item) => item.kind !== 'sex'), filter]))
    } else {
      onChange(dedupeFilters([...filters, filter]))
    }
    setText('')
    setOpen(false)
  }

  function addText(raw: string) {
    const typed = tokenToFilter(raw, scope)
    if (typed && (typed.kind === 'ontology' || typed.kind === 'custom')) {
      const match = applicable.find((term) => term.id.toLowerCase() === typed.id.toLowerCase())
      add({ ...typed, label: match?.label })
      return
    }
    if (typed) {
      add(typed)
      return
    }
    const sex = sexTerm?.values?.find(
      (value) => value.toLowerCase() === raw.trim().toLowerCase()
    )
    if (sex && scope !== 'feature') add({ kind: 'sex', value: sex })
  }

  function addTerm(term: FilteringTerm) {
    if (term.type === 'alphanumeric' && term.id === 'genomicFeature.symbol') return
    if (term.type === 'custom' || term.id === 'GEO:sample' || term.id.startsWith('resource:')) {
      add({ kind: 'custom', id: term.id, label: term.label })
      return
    }
    add({ kind: 'ontology', id: term.id, label: term.label })
  }

  return (
    <div>
      <div className="relative max-w-xl">
        <div className="flex items-center gap-3 rounded-lg border border-[#cbd9de] bg-white px-3">
          <span className="text-[#829198]">/</span>
          <input
            aria-label="Add Beacon filter"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addText(text)
              }
              if (event.key === 'Escape') setOpen(false)
            }}
            placeholder={
              scope === 'biosample'
                ? 'Tissue, cell type, UBERON:…, EFO:…'
                : 'Gene symbol, HGNC:…, ENSEMBL:…, SO:…'
            }
            className="w-full py-3 text-sm outline-none"
          />
        </div>
        {open && (suggestions.length > 0 || text.trim()) && (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[#dce7ea] bg-white py-1 shadow-md">
            {suggestions.map((term) => (
              <li key={`${term.type}:${term.id}`}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    addTerm(term)
                  }}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#f5faf9]"
                >
                  <span>{term.label || term.id}</span>
                  <span className="font-mono text-[10px] text-[#829198]">{term.id}</span>
                </button>
              </li>
            ))}
            {text.trim() && tokenToFilter(text, scope) && (
              <li>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    addText(text)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-[#0c6870] hover:bg-[#f5faf9]"
                >
                  Add “{text.trim()}”
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {sexTerm?.values && sexTerm.values.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sexTerm.values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => add({ kind: 'sex', value })}
              className="rounded-full border border-[#cbd9de] bg-white px-3 py-1 text-xs text-[#405761] hover:border-[#0c7c86]"
            >
              sex = {value}
            </button>
          ))}
        </div>
      )}
      {customTerms.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {customTerms.map((term) => (
            <button
              key={term.id}
              type="button"
              onClick={() => addTerm(term)}
              className="rounded-full border border-[#cbd9de] bg-white px-3 py-1 text-xs text-[#405761] hover:border-[#0c7c86]"
            >
              {term.label || term.id}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="mt-2 text-xs text-[#829198]">Loading filtering terms…</p>}
      {error && <p className="mt-2 text-xs text-[#a34c3b]">{error}</p>}
    </div>
  )
}
