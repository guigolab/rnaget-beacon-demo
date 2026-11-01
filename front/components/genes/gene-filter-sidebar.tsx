'use client'

import {
  FilteringTermBrowser,
  FilteringTermSidebar,
} from '@/components/shared/filtering-term-browser'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { UiFilter } from '@/lib/beacon'

type GeneFilterSidebarProps = {
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  termsPath?: string
  source?: string
}

export function GeneFilterSidebar({
  activeFilters,
  onAddFilter,
  termsPath = '/features/filtering_terms',
  source,
}: GeneFilterSidebarProps) {
  const { terms, resources, error, loading } = useFilteringTerms(termsPath)

  return (
    <FilteringTermSidebar
      source={source ?? `GET ${termsPath}`}
      loading={loading}
      error={error}
    >
      <FilteringTermBrowser
        scope="genomicFeature"
        terms={terms}
        resources={resources}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
      />
    </FilteringTermSidebar>
  )
}
