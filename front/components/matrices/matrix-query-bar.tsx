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
import { matrixLensQueryExamples, mergeMatrixLensFilters } from '@/lib/matrix-lens'
import type { LensProbe } from '@/lib/lens-preview-note'

type MatrixQueryBarProps = {
  filters: UiFilter[]
  onChange: (filters: UiFilter[]) => void
  probe: LensProbe
  scopeIndex?: FilterScopeIndex
  termsPath?: string
}

export function MatrixQueryBar({
  filters,
  onChange,
  probe,
  scopeIndex,
  termsPath = '/filtering_terms',
}: MatrixQueryBarProps) {
  const { terms, resources, error, loading } = useFilteringTerms(termsPath)
  const labelCatalog = useMemo(() => catalogLabelById(terms), [terms])
  const examples = useMemo(
    () => (loading ? [] : matrixLensQueryExamples(terms)),
    [loading, terms]
  )
  const alphanumericTerms = useMemo(
    () =>
      terms.filter(
        (term) => term.type === 'alphanumeric' && (term.scopes?.includes('matrix') ?? false)
      ),
    [terms]
  )
  const placeholder =
    loading && !terms.length
      ? 'Add filter…'
      : lensQueryPlaceholder('matrix', terms, resources)

  function resolveText(raw: string): UiFilter | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const typed = tokenToFilter(trimmed, 'matrix', scopeIndex)
    if (typed && typed.kind === 'ontology') {
      const match = terms.find((term) => term.id.toLowerCase() === typed.id.toLowerCase())
      return { ...typed, label: match?.label ?? typed.label }
    }
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
    return typed
  }

  return (
    <LensQueryBar
      label="Add matrix filter"
      placeholder={placeholder}
      filters={filters}
      onChange={onChange}
      probe={probe}
      examples={examples}
      labelCatalog={labelCatalog}
      resolveText={resolveText}
      mergeAdded={mergeMatrixLensFilters}
      catalogError={error}
    />
  )
}
