'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  filterKey,
  isAbortError,
  listExpressionValues,
  type ExpressionValue,
  type UiFilter,
} from '@/lib/beacon'
import {
  deriveSliceHeatmapAxes,
  sliceAxesCanExtend,
  sliceAxesGrew,
  SLICE_LIMIT,
  type SliceHeatmapAxes,
} from '@/lib/matrix-expression-slice'

export type MatrixExpressionSliceState = {
  cells: ExpressionValue[]
  axes: SliceHeatmapAxes
  total: number
  status: 'loading' | 'ready' | 'error'
  error: string
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => void
  retry: () => void
}

type UseMatrixExpressionSliceInput = {
  matrixId: string
  order: 'asc' | 'desc'
  minValue?: number
  maxValue?: number
  filters: UiFilter[]
  featureIDList?: string
  biosampleIDList?: string
  enabled?: boolean
}

export function useMatrixExpressionSlice(
  input: UseMatrixExpressionSliceInput
): MatrixExpressionSliceState {
  const enabled = input.enabled !== false
  const filtersKey = input.filters.map((filter) => filterKey(filter)).join('|')
  const requestKey = JSON.stringify({
    matrixId: input.matrixId,
    order: input.order,
    minValue: input.minValue ?? null,
    maxValue: input.maxValue ?? null,
    filtersKey,
    featureIDList: input.featureIDList ?? '',
    biosampleIDList: input.biosampleIDList ?? '',
  })

  const [attempt, setAttempt] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cells, setCells] = useState<ExpressionValue[]>([])
  const [total, setTotal] = useState(0)
  const [nextPage, setNextPage] = useState<string | undefined>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [requestKeyState, setRequestKeyState] = useState('')

  const genRef = useRef(0)
  const moreRef = useRef(false)
  const moreControllerRef = useRef<AbortController | null>(null)
  const nextPageRef = useRef<string | undefined>(undefined)
  const cellsRef = useRef<ExpressionValue[]>([])
  nextPageRef.current = nextPage
  cellsRef.current = cells

  const filtersRef = useRef(input.filters)
  filtersRef.current = input.filters

  useEffect(() => {
    if (!enabled) {
      setStatus('ready')
      setCells([])
      setTotal(0)
      setNextPage(undefined)
      setError('')
      setRequestKeyState(requestKey)
      return
    }
    const gen = ++genRef.current
    moreControllerRef.current?.abort()
    moreRef.current = false
    setLoadingMore(false)
    setStatus('loading')
    setError('')
    setCells([])
    setTotal(0)
    setNextPage(undefined)
    setRequestKeyState(requestKey)

    const controller = new AbortController()
    listExpressionValues(input.matrixId, {
      limit: SLICE_LIMIT,
      order: input.order,
      minValue: input.minValue,
      maxValue: input.maxValue,
      filters: filtersRef.current,
      featureIDList: input.featureIDList,
      biosampleIDList: input.biosampleIDList,
      signal: controller.signal,
    })
      .then((page) => {
        if (genRef.current !== gen) return
        setCells(page.results)
        setTotal(page.total ?? page.results.length)
        setNextPage(page.nextPage)
        setStatus('ready')
        setError('')
      })
      .catch((err: unknown) => {
        if (genRef.current !== gen || isAbortError(err)) return
        setCells([])
        setTotal(0)
        setNextPage(undefined)
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Expression slice failed')
      })

    return () => {
      controller.abort()
    }
  }, [
    attempt,
    enabled,
    input.biosampleIDList,
    input.featureIDList,
    input.matrixId,
    input.maxValue,
    input.minValue,
    input.order,
    requestKey,
  ])

  const axes = useMemo(() => deriveSliceHeatmapAxes(cells), [cells])

  const hasMore =
    Boolean(nextPage) &&
    requestKeyState === requestKey &&
    sliceAxesCanExtend(axes.featureIds.length, axes.biosampleIds.length)

  const loadMore = useCallback(() => {
    const token = nextPageRef.current?.trim()
    if (!enabled || !token || moreRef.current) return
    const currentAxes = deriveSliceHeatmapAxes(cellsRef.current)
    if (
      !sliceAxesCanExtend(
        currentAxes.featureIds.length,
        currentAxes.biosampleIds.length
      )
    ) {
      return
    }
    moreRef.current = true
    const controller = new AbortController()
    moreControllerRef.current = controller
    setLoadingMore(true)
    listExpressionValues(input.matrixId, {
      limit: SLICE_LIMIT,
      pageToken: token,
      order: input.order,
      minValue: input.minValue,
      maxValue: input.maxValue,
      filters: filtersRef.current,
      featureIDList: input.featureIDList,
      biosampleIDList: input.biosampleIDList,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return
        const before = deriveSliceHeatmapAxes(cellsRef.current)
        const merged = [...cellsRef.current, ...page.results]
        const after = deriveSliceHeatmapAxes(merged)
        setCells(merged)
        if (page.total != null) setTotal(page.total)
        // Stop when this page cannot grow capped axes (avoids unbounded paging).
        setNextPage(
          page.results.length && sliceAxesGrew(before, after)
            ? page.nextPage
            : undefined
        )
        setError('')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Expression slice failed')
      })
      .finally(() => {
        if (controller.signal.aborted) return
        moreRef.current = false
        moreControllerRef.current = null
        setLoadingMore(false)
      })
  }, [
    enabled,
    input.biosampleIDList,
    input.featureIDList,
    input.matrixId,
    input.maxValue,
    input.minValue,
    input.order,
  ])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    cells,
    axes,
    total,
    status,
    error,
    loadingMore,
    hasMore,
    loadMore,
    retry,
  }
}
