'use client'

import {
  FilteringTermBrowser,
  FilteringTermSidebar,
} from '@/components/shared/filtering-term-browser'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { UiFilter } from '@/lib/beacon'

type MatrixFilterSidebarProps = {
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  termsPath?: string
  source?: string
}

export function MatrixFilterSidebar({
  activeFilters,
  onAddFilter,
  termsPath = '/matrices/filtering_terms',
  source,
}: MatrixFilterSidebarProps) {
  const { terms, resources, error, loading } = useFilteringTerms(termsPath)

  return (
    <FilteringTermSidebar
      source={source ?? `GET ${termsPath}`}
      loading={loading}
      error={error}
    >
      <FilteringTermBrowser
        scope="matrix"
        terms={terms}
        resources={resources}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
      />
    </FilteringTermSidebar>
  )
}
