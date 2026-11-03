'use client'

import { useMemo } from 'react'
import { buildFilterScopeIndex, type FilterScopeIndex } from '@/lib/beacon'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'

/** Root filtering-term scopes for URL routing across lenses. */
export function useMergedFilterScopeIndex(): FilterScopeIndex {
  const { terms } = useFilteringTerms('/filtering_terms')

  return useMemo(() => buildFilterScopeIndex(terms), [terms])
}
