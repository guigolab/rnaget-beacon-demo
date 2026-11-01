'use client'

import { useEffect, useState } from 'react'
import { getFilteringTerms, peekFilteringTerms } from '@/lib/beacon'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon'

export function useFilteringTerms(path: string) {
  const cached = peekFilteringTerms(path)
  const [terms, setTerms] = useState<FilteringTerm[]>(cached?.terms ?? [])
  const [resources, setResources] = useState<FilteringResource[]>(cached?.resources ?? [])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    const hit = peekFilteringTerms(path)
    if (hit) {
      setTerms(hit.terms)
      setResources(hit.resources)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    getFilteringTerms(path)
      .then((data) => {
        if (!cancelled) {
          setTerms(data.terms)
          setResources(data.resources)
        }
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
  }, [path])

  return { terms, resources, error, loading }
}
