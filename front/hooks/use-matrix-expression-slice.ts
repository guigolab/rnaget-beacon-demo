'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isAbortError,
  listExpressionValues,
  type ExpressionValue,
} from '@/lib/beacon'
import {
  deriveSliceHeatmapAxes,
  sliceAxesCanExtend,
  sliceAxesGrew,
  sliceDistinctCounts,
  SLICE_BIOSAMPLE_CAP,
  SLICE_FEATURE_CAP,
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
  /** More feature rows exist than the current cap shows. */
  hasMoreFeatures: boolean
  /** More biosample columns exist than the current cap shows. */
  hasMoreBiosamples: boolean
  loadMore: () => void
  retry: () => void
}

type UseMatrixExpressionSliceInput = {
  matrixId: string
  order: 'asc' | 'desc'
  minValue?: number
  maxValue?: number
  featureIDList?: string
  biosampleIDList?: string
  /** Visible axis caps; raise them to reveal more of the ranked cells. */
  featureCap?: number
  biosampleCap?: number
  enabled?: boolean
  /** While disabled, keep showing the previous cells (the inputs are still resolving). */
  holdWhenDisabled?: boolean
}

export function useMatrixExpressionSlice(
  input: UseMatrixExpressionSliceInput
): MatrixExpressionSliceState {
  const enabled = input.enabled !== false
  const holdWhenDisabled = input.holdWhenDisabled === true
  const featureCap = input.featureCap ?? SLICE_FEATURE_CAP
  const biosampleCap = input.biosampleCap ?? SLICE_BIOSAMPLE_CAP
  const capsRef = useRef({ featureCap, biosampleCap })
  capsRef.current = { featureCap, biosampleCap }
  const requestKey = JSON.stringify({
    matrixId: input.matrixId,
    order: input.order,
    minValue: input.minValue ?? null,
    maxValue: input.maxValue ?? null,
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

  useEffect(() => {
    if (!enabled) {
      if (holdWhenDisabled) return
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
    // Keep the previous cells on screen until the new page replaces them.
    setStatus('loading')
    setError('')
    setNextPage(undefined)
    setRequestKeyState(requestKey)

    const controller = new AbortController()
    listExpressionValues(input.matrixId, {
      limit: SLICE_LIMIT,
      order: input.order,
      minValue: input.minValue,
      maxValue: input.maxValue,
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
    holdWhenDisabled,
    input.biosampleIDList,
    input.featureIDList,
    input.matrixId,
    input.maxValue,
    input.minValue,
    input.order,
    requestKey,
  ])

  const axes = useMemo(
    () => deriveSliceHeatmapAxes(cells, featureCap, biosampleCap),
    [cells, featureCap, biosampleCap]
  )
  const distinct = useMemo(() => sliceDistinctCounts(cells), [cells])
  const settled = requestKeyState === requestKey

  const hasMore =
    Boolean(nextPage) &&
    settled &&
    sliceAxesCanExtend(
      axes.featureIds.length,
      axes.biosampleIds.length,
      featureCap,
      biosampleCap
    )
  const hasMoreFeatures =
    settled && (distinct.features > axes.featureIds.length || Boolean(nextPage))
  const hasMoreBiosamples =
    settled &&
    (distinct.biosamples > axes.biosampleIds.length || Boolean(nextPage))

  const loadMore = useCallback(() => {
    const token = nextPageRef.current?.trim()
    if (!enabled || !token || moreRef.current) return
    const caps = capsRef.current
    const currentAxes = deriveSliceHeatmapAxes(
      cellsRef.current,
      caps.featureCap,
      caps.biosampleCap
    )
    if (
      !sliceAxesCanExtend(
        currentAxes.featureIds.length,
        currentAxes.biosampleIds.length,
        caps.featureCap,
        caps.biosampleCap
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
      featureIDList: input.featureIDList,
      biosampleIDList: input.biosampleIDList,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return
        const before = deriveSliceHeatmapAxes(
          cellsRef.current,
          caps.featureCap,
          caps.biosampleCap
        )
        const merged = [...cellsRef.current, ...page.results]
        const after = deriveSliceHeatmapAxes(
          merged,
          caps.featureCap,
          caps.biosampleCap
        )
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

  // Raising a cap past what the loaded cells cover pulls the next ranked page.
  useEffect(() => {
    if (status === 'ready' && hasMore && !loadingMore) loadMore()
  }, [status, hasMore, loadingMore, loadMore, featureCap, biosampleCap])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    cells,
    axes,
    total,
    status,
    error,
    loadingMore,
    hasMore,
    hasMoreFeatures,
    hasMoreBiosamples,
    loadMore,
    retry,
  }
}
