'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isAbortError,
  listMatrixBiosamples,
  listMatrixFeatures,
  filterKey,
  type Biosample,
  type Feature,
  type UiFilter,
} from '@/lib/beacon'
import { appendAxisPage } from '@/lib/matrix-axis-page'

type AxisItem = Feature | Biosample

type AxisSnapshot<T> = {
  requestKey: string
  items: T[]
  total: number
  /** Server offset for the next page. Independent of client-side id dedupe. */
  nextSkip: number
  status: 'loading' | 'ready' | 'error'
  error: string
}

export type MatrixAxisState<T> = {
  items: T[]
  total: number
  status: 'loading' | 'ready' | 'error'
  error: string
  /** True while the committed page belongs to an older query. */
  stale: boolean
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => void
  retry: () => void
}

type UseMatrixAxisInput = {
  matrixId: string
  axis: 'features' | 'biosamples'
  filters: UiFilter[]
  featureIDList?: string
  biosampleIDList?: string
  pageSize: number
  enabled?: boolean
}

export function useMatrixAxis<T extends AxisItem>(input: UseMatrixAxisInput): MatrixAxisState<T> {
  const enabled = input.enabled !== false
  const filtersKey = input.filters.map((filter) => filterKey(filter)).join('|')
  const filtersRef = useRef(input.filters)
  filtersRef.current = input.filters

  const requestKey = JSON.stringify({
    matrixId: input.matrixId,
    axis: input.axis,
    filtersKey,
    featureIDList: input.axis === 'features' ? (input.featureIDList ?? '') : '',
    biosampleIDList: input.axis === 'biosamples' ? (input.biosampleIDList ?? '') : '',
    pageSize: input.pageSize,
  })

  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [snapshot, setSnapshot] = useState<AxisSnapshot<T>>({
    requestKey: '',
    items: [],
    total: 0,
    nextSkip: 0,
    status: 'loading',
    error: '',
  })
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const genRef = useRef(0)
  const moreRef = useRef(false)
  const moreControllerRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(
    (skip: number, signal: AbortSignal) => {
      const opts =
        input.axis === 'features'
          ? {
              filters: filtersRef.current,
              featureIDList: input.featureIDList,
              signal,
            }
          : {
              filters: filtersRef.current,
              biosampleIDList: input.biosampleIDList,
              signal,
            }
      return input.axis === 'features'
        ? listMatrixFeatures(input.matrixId, skip, input.pageSize, opts)
        : listMatrixBiosamples(input.matrixId, skip, input.pageSize, opts)
    },
    [
      input.axis,
      input.biosampleIDList,
      input.featureIDList,
      input.matrixId,
      input.pageSize,
    ]
  )

  useEffect(() => {
    if (!enabled) return
    const gen = ++genRef.current
    moreControllerRef.current?.abort()
    moreRef.current = false
    const controller = new AbortController()
    setSnapshot((prev) => ({ ...prev, status: 'loading', error: '' }))
    setLoadingMore(false)
    fetchPage(0, controller.signal)
      .then((page) => {
        if (genRef.current !== gen) return
        const items = page.results as T[]
        setSnapshot({
          requestKey,
          items,
          total: page.total ?? items.length,
          nextSkip: page.results.length,
          status: 'ready',
          error: '',
        })
      })
      .catch((err: unknown) => {
        if (genRef.current !== gen || isAbortError(err)) return
        setSnapshot((prev) => ({
          requestKey,
          items: prev.requestKey === requestKey ? prev.items : [],
          total: prev.requestKey === requestKey ? prev.total : 0,
          nextSkip: prev.requestKey === requestKey ? prev.nextSkip : 0,
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to load',
        }))
      })
    return () => {
      controller.abort()
      moreControllerRef.current?.abort()
    }
  }, [enabled, fetchPage, requestKey, attempt])

  const loadMore = useCallback(() => {
    const current = snapshotRef.current
    if (!enabled || moreRef.current || genRef.current === 0) return
    if (current.requestKey !== requestKey || current.status === 'error') return
    if (current.items.length >= current.total) return
    const gen = genRef.current
    moreRef.current = true
    setLoadingMore(true)
    moreControllerRef.current?.abort()
    const controller = new AbortController()
    moreControllerRef.current = controller
    fetchPage(current.nextSkip, controller.signal)
      .then((page) => {
        if (genRef.current !== gen) return
        setSnapshot((prev) => {
          if (prev.requestKey !== requestKey) return prev
          if (!page.results.length) {
            return {
              ...prev,
              total: prev.items.length,
              status: 'ready',
              error: '',
            }
          }
          return {
            ...prev,
            items: appendAxisPage(prev.items, page.results as T[]),
            total: page.total ?? prev.total,
            nextSkip: prev.nextSkip + page.results.length,
            status: 'ready',
            error: '',
          }
        })
      })
      .catch((err: unknown) => {
        if (genRef.current !== gen || isAbortError(err)) return
        setSnapshot((prev) => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to load more',
        }))
      })
      .finally(() => {
        if (genRef.current === gen) {
          moreRef.current = false
          setLoadingMore(false)
        }
      })
  }, [enabled, fetchPage, requestKey])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const settled = snapshot.requestKey === requestKey
  const items = snapshot.items
  const hasMore = settled && items.length < snapshot.total

  return {
    items,
    total: settled ? snapshot.total : items.length > 0 ? snapshot.total : 0,
    status: settled ? snapshot.status : 'loading',
    error: settled ? snapshot.error : '',
    stale: !settled && items.length > 0,
    loadingMore,
    hasMore,
    loadMore,
    retry,
  }
}
