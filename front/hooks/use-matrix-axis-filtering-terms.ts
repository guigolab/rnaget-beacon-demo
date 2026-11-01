'use client'

import { useEffect, useState } from 'react'
import {
  BeaconError,
  getFilteringTerms,
  peekFilteringTerms,
  type FilteringResource,
  type FilteringTerm,
} from '@/lib/beacon'
import {
  matrixHeatmapFilteringTermsPath,
  matrixHeatmapFilteringTermsFallbackPath,
} from '@/lib/matrix-workspace'

async function loadAxisTerms(
  matrixId: string,
  axis: 'features' | 'biosamples'
): Promise<{ terms: FilteringTerm[]; resources: FilteringResource[] }> {
  const primary = matrixHeatmapFilteringTermsPath(matrixId, axis)
  const cached = peekFilteringTerms(primary)
  if (cached) return cached

  try {
    return await getFilteringTerms(primary)
  } catch (err: unknown) {
    const fallback = matrixHeatmapFilteringTermsFallbackPath(axis)
    if (err instanceof BeaconError && err.status === 404) {
      return getFilteringTerms(fallback)
    }
    throw err
  }
}

/** Matrix-scoped filtering terms with global axis fallback when the API has no matrix route yet. */
export function useMatrixAxisFilteringTerms(
  matrixId: string,
  axis: 'features' | 'biosamples'
) {
  const [terms, setTerms] = useState<FilteringTerm[]>([])
  const [resources, setResources] = useState<FilteringResource[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    loadAxisTerms(matrixId, axis)
      .then((data) => {
        if (cancelled) return
        setTerms(data.terms)
        setResources(data.resources)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTerms([])
        setResources([])
        setError(err instanceof Error ? err.message : 'Failed to load filtering terms')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [matrixId, axis])

  return { terms, resources, error, loading }
}
