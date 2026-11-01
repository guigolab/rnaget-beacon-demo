'use client'

import { useMemo } from 'react'
import {
  buildFilterScopeIndex,
  mergeFilterScopeIndexes,
  type FilterScopeIndex,
} from '@/lib/beacon'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'

/** Union of feature, biosample, and matrix filtering-term scopes for URL routing. */
export function useMergedFilterScopeIndex(): FilterScopeIndex {
  const { terms: featureTerms } = useFilteringTerms('/features/filtering_terms')
  const { terms: biosampleTerms } = useFilteringTerms('/biosamples/filtering_terms')
  const { terms: matrixTerms } = useFilteringTerms('/matrices/filtering_terms')

  return useMemo(
    () =>
      mergeFilterScopeIndexes(
        buildFilterScopeIndex(featureTerms),
        buildFilterScopeIndex(biosampleTerms),
        buildFilterScopeIndex(matrixTerms)
      ),
    [featureTerms, biosampleTerms, matrixTerms]
  )
}
