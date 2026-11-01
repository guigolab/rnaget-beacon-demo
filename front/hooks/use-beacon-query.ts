'use client'

import { useEffect, useState } from 'react'
import { isAbortError, queryCollection } from '@/lib/beacon'
import type { BeaconResult, Granularity, UiFilter } from '@/lib/beacon'

export function useBeaconQuery<T>(
  path: string,
  opts: {
    filters: UiFilter[]
    granularity: Granularity
    skip: number
    limit: number
  }
) {
  const [result, setResult] = useState<BeaconResult<T> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const key = JSON.stringify({ path, ...opts })

  useEffect(() => {
    const request = JSON.parse(key) as {
      path: string
      filters: UiFilter[]
      granularity: Granularity
      skip: number
      limit: number
    }
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setError('')
    queryCollection<T>(request.path, { ...request, signal: controller.signal })
      .then((page) => {
        if (!cancelled) setResult(page)
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setResult(null)
        setError(err instanceof Error ? err.message : 'Beacon request failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key])

  return { result, error, loading }
}
