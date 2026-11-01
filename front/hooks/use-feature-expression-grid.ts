'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { listMatrixExpressionSummary, type ExpressionSummary } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import { mapPool } from '@/lib/async-pool'
import {
  applySummaryRows,
  cellKey,
  matrixBatchCacheKey,
  matrixIdsForFeatures,
  matrixSummaryBatches,
  type FeatureMatrixCell,
} from '@/lib/feature-expression-grid'

export type { FeatureMatrixCell }

const summaryCache = new Map<string, ExpressionSummary[]>()
const summaryInflight = new Map<string, Promise<ExpressionSummary[]>>()

function loadMatrixBatch(
  matrixId: string,
  featureIDList: string
): Promise<ExpressionSummary[]> {
  const key = matrixBatchCacheKey(matrixId, featureIDList)
  const cached = summaryCache.get(key)
  if (cached) return Promise.resolve(cached)

  let pending = summaryInflight.get(key)
  if (pending) return pending

  pending = listMatrixExpressionSummary(matrixId, { featureIDList })
    .then((page) => {
      const rows = page.results ?? []
      summaryCache.set(key, rows)
      return rows
    })
    .finally(() => {
      summaryInflight.delete(key)
    })

  summaryInflight.set(key, pending)
  return pending
}

function cellsFromCache(features: Feature[]): Map<string, FeatureMatrixCell> {
  const next = new Map<string, FeatureMatrixCell>()
  for (const { matrixId, featureIDList } of matrixSummaryBatches(features)) {
    const rows = summaryCache.get(matrixBatchCacheKey(matrixId, featureIDList))
    if (rows?.length) applySummaryRows(next, features, matrixId, rows)
  }
  return next
}

export function useFeatureExpressionGrid(features: Feature[]) {
  const featureKey = useMemo(
    () => features.map((f) => f.id).join('|'),
    [features]
  )
  const featuresRef = useRef(features)
  featuresRef.current = features

  const [cells, setCells] = useState<Map<string, FeatureMatrixCell>>(() =>
    cellsFromCache(features)
  )
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const fetchGenRef = useRef(0)

  useEffect(() => {
    const current = featuresRef.current
    const gen = ++fetchGenRef.current

    setCells((prev) => {
      const hydrated = cellsFromCache(current)
      if (hydrated.size === 0 && prev.size === 0) return prev
      let changed = prev.size !== hydrated.size
      if (!changed) {
        for (const [k, v] of hydrated) {
          if (prev.get(k)?.median !== v.median) {
            changed = true
            break
          }
        }
      }
      return changed ? hydrated : prev
    })

    const batches = matrixSummaryBatches(current)
    const needFetch = batches.filter(
      ({ matrixId, featureIDList }) =>
        !summaryCache.has(matrixBatchCacheKey(matrixId, featureIDList))
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
      await mapPool(needFetch, 5, async ({ matrixId, featureIDList }) => {
        if (cancelled || fetchGenRef.current !== gen) return
        try {
          const rows = await loadMatrixBatch(matrixId, featureIDList)
          if (cancelled || fetchGenRef.current !== gen) return
          setCells((prev) => {
            const next = new Map(prev)
            applySummaryRows(next, featuresRef.current, matrixId, rows)
            return next
          })
        } catch (err: unknown) {
          if (!cancelled && fetchGenRef.current === gen) {
            setError(
              err instanceof Error ? err.message : 'Expression summary failed'
            )
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
  }, [featureKey])

  const matrixIds = useMemo(
    () => matrixIdsForFeatures(features),
    [featureKey, features]
  )

  function getCell(featureId: string, matrixId: string): FeatureMatrixCell | undefined {
    return cells.get(cellKey(featureId, matrixId))
  }

  return {
    loading: pendingCount > 0,
    pendingCount,
    error,
    matrixIds,
    getCell,
  }
}
