'use client'

import { useMemo } from 'react'
import { LensQueryBar } from '@/components/shared/lens-query-bar'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import {
  tokenToFilter,
  type FilterScopeIndex,
  type UiFilter,
} from '@/lib/beacon'
import { catalogLabelById } from '@/lib/gene-filter-labels'
import { lensQueryPlaceholder } from '@/lib/lens-catalog'
import { mergeSampleLensFilters, sampleLensQueryExamples } from '@/lib/sample-lens'
import type { LensProbe } from '@/lib/lens-preview-note'

type BiosampleQueryBarProps = {
  filters: UiFilter[]
  onChange: (filters: UiFilter[]) => void
  probe: LensProbe
  scopeIndex?: FilterScopeIndex
  termsPath?: string
}

export function BiosampleQueryBar({
  filters,
  onChange,
  probe,
  scopeIndex,
  termsPath = '/biosamples/filtering_terms',
}: BiosampleQueryBarProps) {
  const { terms, resources, error, loading } = useFilteringTerms(termsPath)
  const labelCatalog = useMemo(() => catalogLabelById(terms), [terms])
  const examples = useMemo(
    () => (loading ? [] : sampleLensQueryExamples(terms)),
    [loading, terms]
  )
  const alphanumericTerms = useMemo(
    () =>
      terms.filter(
        (term) =>
          term.type === 'alphanumeric' &&
          (term.scopes?.includes('biosample') ?? false) &&
          term.id !== 'sex'
      ),
    [terms]
  )
  const placeholder =
    loading && !terms.length
      ? 'Add filter…'
      : lensQueryPlaceholder('biosample', terms, resources)

  function resolveText(raw: string): UiFilter | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const typed = tokenToFilter(trimmed, 'biosample', scopeIndex)
    if (typed && (typed.kind === 'ontology' || typed.kind === 'custom')) {
      const match = terms.find((term) => term.id.toLowerCase() === typed.id.toLowerCase())
      return { ...typed, label: match?.label ?? typed.label }
    }
    if (typed) return typed

    const sexTerm = terms.find((term) => term.id === 'sex')
    const sex = sexTerm?.values?.find(
      (value) => value.toLowerCase() === trimmed.toLowerCase()
    )
    if (sex) return { kind: 'sex', value: sex }

    for (const term of alphanumericTerms) {
      const hit = term.values?.find((value) => value.toLowerCase() === trimmed.toLowerCase())
      if (hit) {
        return {
          kind: 'alphanumeric',
          id: term.id,
          value: hit,
          label: `${term.label ?? term.id} = ${hit}`,
        }
      }
    }
    return null
  }

  return (
    <LensQueryBar
      label="Add biosample filter"
      placeholder={placeholder}
      filters={filters}
      onChange={onChange}
      probe={probe}
      examples={examples}
      labelCatalog={labelCatalog}
      resolveText={resolveText}
      mergeAdded={mergeSampleLensFilters}
      catalogError={error}
    />
  )
}
