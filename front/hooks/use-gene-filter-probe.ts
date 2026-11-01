'use client'

import { useEffect, useMemo, useState } from 'react'
import { filterKey, listFeatures, type UiFilter } from '@/lib/beacon'

export type GeneFilterProbe = {
  loading: boolean
  exists?: boolean
  total?: number
  error: string
}

export function useGeneFilterProbe(filters: UiFilter[]): GeneFilterProbe {
  const filterKeyLine = useMemo(
    () => filters.map((f) => filterKey(f)).join('|'),
    [filters]
  )
  const [loading, setLoading] = useState(false)
  const [exists, setExists] = useState<boolean | undefined>()
  const [total, setTotal] = useState<number | undefined>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!filters.length) {
      setLoading(false)
      setExists(undefined)
      setTotal(undefined)
      setError('')
      return
    }

    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      setExists(undefined)
      setTotal(undefined)
      try {
        const booleanPage = await listFeatures(0, 1, {
          filters,
          granularity: 'boolean',
        })
        if (cancelled) return
        const hit = booleanPage.exists
        setExists(hit)
        if (!hit) {
          setTotal(0)
          return
        }
        const countPage = await listFeatures(0, 1, {
          filters,
          granularity: 'count',
        })
        if (cancelled) return
        setTotal(countPage.total ?? 0)
      } catch (err: unknown) {
        if (!cancelled) {
          setExists(undefined)
          setTotal(undefined)
          setError(err instanceof Error ? err.message : 'Beacon query failed')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [filterKeyLine, filters])

  return { loading, exists, total, error }
}
