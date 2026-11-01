'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isAbortError, type BeaconResult } from '@/lib/beacon'
import type { LensProbe } from '@/lib/lens-preview-note'

export type LensList<T> = LensProbe & {
  items: T[]
  loadingMore: boolean
  refreshing: boolean
  loadMore: () => void
}

type FetchPage<T> = (
  skip: number,
  limit: number,
  signal: AbortSignal
) => Promise<BeaconResult<T>>

function appendUnique<T>(current: T[], page: T[], itemKey: (item: T) => string): T[] {
  if (!page.length) return current
  const seen = new Set(current.map(itemKey))
  const next = current.slice()
  for (const item of page) {
    const key = itemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

/**
 * One record-granularity page at a time. Refetches replace the first page and
 * keep the previous rows visible; load-more appends the next page.
 */
export function useLensList<T>(opts: {
  queryKey: string
  pageSize: number
  enabled: boolean
  fetchPage: FetchPage<T>
  itemKey: (item: T) => string
}): LensList<T> {
  const fetchRef = useRef(opts.fetchPage)
  fetchRef.current = opts.fetchPage
  const itemKeyRef = useRef(opts.itemKey)
  itemKeyRef.current = opts.itemKey
  const { queryKey, pageSize, enabled } = opts

  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState<number | undefined>()
  const [exists, setExists] = useState<boolean | undefined>()
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const genRef = useRef(0)
  const nextSkipRef = useRef(0)
  const moreRef = useRef<AbortController | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (!enabled) {
      genRef.current += 1
      moreRef.current?.abort()
      setItems([])
      setTotal(undefined)
      setExists(undefined)
      setLoading(false)
      setLoadingMore(false)
      setError('')
      nextSkipRef.current = 0
      return
    }

    const gen = ++genRef.current
    moreRef.current?.abort()
    const controller = new AbortController()
    setLoading(true)
    setLoadingMore(false)
    setError('')

    fetchRef
      .current(0, pageSize, controller.signal)
      .then((page) => {
        if (genRef.current !== gen) return
        const results = page.results ?? []
        const nextTotal = page.total ?? results.length
        setItems(results)
        setTotal(nextTotal)
        setExists(page.exists !== false && nextTotal > 0)
        nextSkipRef.current = results.length
      })
      .catch((err: unknown) => {
        if (genRef.current !== gen || isAbortError(err)) return
        setItems([])
        setTotal(undefined)
        setExists(undefined)
        setError(err instanceof Error ? err.message : 'Cannot reach the beacon.')
      })
      .finally(() => {
        if (genRef.current === gen) setLoading(false)
      })

    return () => controller.abort()
  }, [enabled, pageSize, queryKey])

  const loadMore = useCallback(() => {
    if (!enabled || loading || loadingMore) return
    if (total != null && itemsRef.current.length >= total) return
    const gen = genRef.current
    const skip = nextSkipRef.current
    moreRef.current?.abort()
    const controller = new AbortController()
    moreRef.current = controller
    setLoadingMore(true)
    setError('')
    fetchRef
      .current(skip, pageSize, controller.signal)
      .then((page) => {
        if (genRef.current !== gen) return
        const results = page.results ?? []
        if (!results.length) {
          setTotal(itemsRef.current.length)
          setExists(itemsRef.current.length > 0)
          return
        }
        setItems((prev) => appendUnique(prev, results, itemKeyRef.current))
        nextSkipRef.current = skip + results.length
        if (page.total != null) setTotal(page.total)
      })
      .catch((err: unknown) => {
        if (genRef.current !== gen || isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Cannot reach the beacon.')
      })
      .finally(() => {
        if (genRef.current === gen) setLoadingMore(false)
      })
  }, [enabled, loading, loadingMore, pageSize, total])

  return {
    items,
    total,
    exists,
    loading,
    loadingMore,
    error,
    refreshing: loading && items.length > 0,
    loadMore,
  }
}
