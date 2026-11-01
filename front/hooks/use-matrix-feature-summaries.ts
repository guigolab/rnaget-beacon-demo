'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  filterKey,
  listMatrixExpressionSummary,
  type ExpressionSummary,
  type UiFilter,
} from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import { mapPool } from '@/lib/async-pool'
import {
  applySummaryRows,
  cellKey,
  chunkCsvTokens,
  EXPRESSION_SUMMARY_ID_LIST_CHUNK,
  type FeatureMatrixCell,
} from '@/lib/feature-expression-grid'
import { nativeFeatureId } from '@/lib/heatmap-expression'

const SUMMARY_CACHE_MAX = 200
const summaryCache = new Map<string, ExpressionSummary[]>()
const summaryInflight = new Map<string, Promise<ExpressionSummary[]>>()

function rememberSummary(key: string, rows: ExpressionSummary[]) {
  if (summaryCache.has(key)) summaryCache.delete(key)
  summaryCache.set(key, rows)
  while (summaryCache.size > SUMMARY_CACHE_MAX) {
    const oldest = summaryCache.keys().next().value
    if (oldest == null) break
    summaryCache.delete(oldest)
  }
}

function batchCacheKey(
  matrixId: string,
  featureIDList: string,
  biosampleFilters: UiFilter[]
) {
  const fk = biosampleFilters.map((f) => filterKey(f)).join('|')
  return `${matrixId}\0${featureIDList}\0${fk}`
}

function loadBatch(
  matrixId: string,
  featureIDList: string,
  biosampleFilters: UiFilter[]
): Promise<ExpressionSummary[]> {
  const key = batchCacheKey(matrixId, featureIDList, biosampleFilters)
  const cached = summaryCache.get(key)
  if (cached) return Promise.resolve(cached)

  let pending = summaryInflight.get(key)
  if (pending) return pending

  pending = listMatrixExpressionSummary(matrixId, {
    featureIDList,
    filters: biosampleFilters.length ? biosampleFilters : undefined,
  })
    .then((page) => {
      const rows = page.results ?? []
      rememberSummary(key, rows)
      return rows
    })
    .finally(() => {
      summaryInflight.delete(key)
    })

  summaryInflight.set(key, pending)
  return pending
}

function cellsFromCache(
  matrixId: string,
  features: Feature[],
  biosampleFilters: UiFilter[]
): Map<string, FeatureMatrixCell> {
  const tokens = features.map(nativeFeatureId)
  const chunks = chunkCsvTokens(tokens, EXPRESSION_SUMMARY_ID_LIST_CHUNK)
  const next = new Map<string, FeatureMatrixCell>()
  for (const featureIDList of chunks) {
    const rows = summaryCache.get(batchCacheKey(matrixId, featureIDList, biosampleFilters))
    if (rows?.length) applySummaryRows(next, features, matrixId, rows)
  }
  return next
}

export function useMatrixFeatureSummaries(
  matrixId: string,
  features: Feature[],
  biosampleFilters: UiFilter[],
  enabled = true
) {
  const featureKey = useMemo(() => features.map((f) => f.id).join('|'), [features])
  const filtersKey = useMemo(
    () => biosampleFilters.map((f) => filterKey(f)).join('|'),
    [biosampleFilters]
  )
  const featuresRef = useRef(features)
  featuresRef.current = features

  const [cells, setCells] = useState<Map<string, FeatureMatrixCell>>(() =>
    enabled ? cellsFromCache(matrixId, features, biosampleFilters) : new Map()
  )
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const fetchGenRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setPendingCount(0)
      return
    }
    if (!features.length) {
      setCells(new Map())
      setPendingCount(0)
      setError('')
      return
    }

    const current = featuresRef.current
    const gen = ++fetchGenRef.current

    setCells(cellsFromCache(matrixId, current, biosampleFilters))
    setError('')

    const tokens = current.map(nativeFeatureId)
    const chunks = chunkCsvTokens(tokens, EXPRESSION_SUMMARY_ID_LIST_CHUNK)
    const needFetch = chunks.filter(
      (featureIDList) =>
        !summaryCache.has(batchCacheKey(matrixId, featureIDList, biosampleFilters))
    )

    if (!needFetch.length) {
      setPendingCount(0)
      return
    }

    let cancelled = false
    setError('')
    let remaining = needFetch.length
    setPendingCount(remaining)

    async function run() {
      await mapPool(needFetch, 3, async (featureIDList) => {
        if (cancelled || fetchGenRef.current !== gen) return
        try {
          const rows = await loadBatch(matrixId, featureIDList, biosampleFilters)
          if (cancelled || fetchGenRef.current !== gen) return
          setCells((prev) => {
            const next = new Map(prev)
            applySummaryRows(next, featuresRef.current, matrixId, rows)
            return next
          })
        } catch (err: unknown) {
          if (!cancelled && fetchGenRef.current === gen) {
            setError(err instanceof Error ? err.message : 'Expression summary failed')
          }
        } finally {
          remaining -= 1
          if (!cancelled && fetchGenRef.current === gen) {
            setPendingCount(Math.max(0, remaining))
          }
        }
      })
    }

    run()
    return () => {
      cancelled = true
    }
  }, [matrixId, featureKey, filtersKey, enabled])

  const getCell = useCallback(
    (featureId: string): FeatureMatrixCell | undefined => cells.get(cellKey(featureId, matrixId)),
    [cells, matrixId]
  )

  return {
    loading: pendingCount > 0,
    pendingCount,
    error,
    getCell,
  }
}
