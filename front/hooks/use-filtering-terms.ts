'use client'

import { useEffect, useState } from 'react'
import { getFilteringTerms, peekFilteringTerms } from '@/lib/beacon'
import type { FilteringTerm } from '@/lib/beacon'

export function useFilteringTerms(path: string) {
  const cached = peekFilteringTerms(path)
  const [terms, setTerms] = useState<FilteringTerm[]>(cached?.terms ?? [])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    const hit = peekFilteringTerms(path)
    if (hit) {
      setTerms(hit.terms)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    getFilteringTerms(path)
      .then((data) => {
        if (!cancelled) setTerms(data.terms)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setTerms([])
        setError(err instanceof Error ? err.message : 'Failed to load filtering terms')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return { terms, error, loading }
}
