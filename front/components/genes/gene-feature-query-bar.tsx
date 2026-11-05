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
import { geneLensQueryExamples, mergeGeneLensFilters } from '@/lib/gene-lens'
import { lensQueryPlaceholder } from '@/lib/lens-catalog'
import type { LensProbe } from '@/lib/lens-preview-note'

type GeneFeatureQueryBarProps = {
  filters: UiFilter[]
  onChange: (filters: UiFilter[]) => void
  probe: LensProbe
  scopeIndex?: FilterScopeIndex
  termsPath?: string
  showExamples?: boolean
}

export function GeneFeatureQueryBar({
  filters,
  onChange,
  probe,
  scopeIndex,
  termsPath = '/filtering_terms',
  showExamples = true,
}: GeneFeatureQueryBarProps) {
  const { terms, resources, error, loading } = useFilteringTerms(termsPath)
  const labelCatalog = useMemo(() => catalogLabelById(terms), [terms])
  const examples = useMemo(
    () => (loading ? [] : geneLensQueryExamples(terms)),
    [loading, terms]
  )
  const placeholder =
    loading && !terms.length
      ? 'Add filter…'
      : lensQueryPlaceholder('feature', terms, resources)

  function resolveText(raw: string): UiFilter | null {
    const typed = tokenToFilter(raw, 'feature', scopeIndex)
    if (!typed) return null
    if (typed.kind === 'ontology' || typed.kind === 'custom') {
      return { ...typed, label: labelCatalog.get(typed.id.toLowerCase()) ?? typed.label }
    }
    return typed
  }

  return (
    <LensQueryBar
      label="Add feature filter"
      placeholder={placeholder}
      filters={filters}
      onChange={onChange}
      probe={probe}
      examples={examples}
      showExamples={showExamples}
      labelCatalog={labelCatalog}
      resolveText={resolveText}
      mergeAdded={mergeGeneLensFilters}
      catalogError={error}
    />
  )
}
