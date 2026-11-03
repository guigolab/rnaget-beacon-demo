'use client'

import {
  FilteringTermBrowser,
  FilteringTermSidebar,
} from '@/components/shared/filtering-term-browser'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { UiFilter } from '@/lib/beacon'

type BiosampleFilterSidebarProps = {
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  termsPath?: string
  source?: string
}

export function BiosampleFilterSidebar({
  activeFilters,
  onAddFilter,
  termsPath = '/filtering_terms',
  source,
}: BiosampleFilterSidebarProps) {
  const { terms, resources, error, loading } = useFilteringTerms(termsPath)

  return (
    <FilteringTermSidebar
      source={source ?? `GET ${termsPath}`}
      loading={loading}
      error={error}
    >
      <FilteringTermBrowser
        scope="biosample"
        terms={terms}
        resources={resources}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
      />
    </FilteringTermSidebar>
  )
}
