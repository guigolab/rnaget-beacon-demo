'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mapPool } from '@/lib/async-pool'
import { medianForMatrix, primarySummaryForMatrix } from '@/lib/gene-lens'
import { queryCollection, type ExpressionSummary, type Feature } from '@/lib/beacon'

export type FeatureMatrixCell = {
  featureId: string
  matrixId: string
  median?: number
  summary?: ExpressionSummary
}

function cellKey(featureId: string, matrixId: string) {
  return `${featureId}\0${matrixId}`
}

const summaryCache = new Map<string, ExpressionSummary[]>()
const summaryInflight = new Map<string, Promise<ExpressionSummary[]>>()

function loadExpressionSummaries(featureId: string): Promise<ExpressionSummary[]> {
  const cached = summaryCache.get(featureId)
  if (cached) return Promise.resolve(cached)

  let pending = summaryInflight.get(featureId)
  if (pending) return pending

  pending = queryCollection<ExpressionSummary>(
    `/features/${encodeURIComponent(featureId)}/expression_summary`,
    { granularity: 'record', limit: 500 }
  )
    .then((page) => {
      const rows = page.results ?? []
      summaryCache.set(featureId, rows)
      return rows
    })
    .finally(() => {
      summaryInflight.delete(featureId)
    })

  summaryInflight.set(featureId, pending)
  return pending
}

function mergeFeatureSummaries(
  target: Map<string, FeatureMatrixCell>,
  feature: Feature,
  rows: ExpressionSummary[]
) {
  const byMatrix = new Map<string, ExpressionSummary[]>()
  for (const row of rows) {
    const mid = row.matrixId
    if (!mid) continue
    const bucket = byMatrix.get(mid) ?? []
    bucket.push(row)
    byMatrix.set(mid, bucket)
  }
  for (const [matrixId, group] of byMatrix) {
    const primary = primarySummaryForMatrix(group)
    target.set(cellKey(feature.id, matrixId), {
      featureId: feature.id,
      matrixId,
      median: medianForMatrix(group),
      summary: primary,
    })
  }
}

function cellsFromFeatures(features: Feature[]): Map<string, FeatureMatrixCell> {
  const next = new Map<string, FeatureMatrixCell>()
  for (const feature of features) {
    const rows = summaryCache.get(feature.id)
    if (rows?.length) mergeFeatureSummaries(next, feature, rows)
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
    cellsFromFeatures(features)
  )
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const fetchedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const feature of featuresRef.current) {
      if (summaryCache.has(feature.id)) fetchedIdsRef.current.add(feature.id)
    }
  }, [featureKey])

  useEffect(() => {
    const current = featuresRef.current
    const currentIdSet = new Set(current.map((f) => f.id))

    for (const id of fetchedIdsRef.current) {
      if (!currentIdSet.has(id)) fetchedIdsRef.current.delete(id)
    }

    setCells((prev) => {
      const hydrated = cellsFromFeatures(current)
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
      if (!changed) return prev
      return hydrated
    })

    const needFetch = current.filter((f) => !fetchedIdsRef.current.has(f.id))
    if (!needFetch.length) {
      setPendingCount(0)
      return
    }

    let cancelled = false
    setError('')

    async function loadOne(feature: Feature) {
      const rows = await loadExpressionSummaries(feature.id)
      if (cancelled) return
      fetchedIdsRef.current.add(feature.id)
      setCells((prev) => {
        const next = new Map(prev)
        mergeFeatureSummaries(next, feature, rows)
        return next
      })
    }

    let remaining = needFetch.length
    setPendingCount(remaining)

    async function run() {
      await mapPool(needFetch, 4, async (feature) => {
        try {
          await loadOne(feature)
        } catch (err: unknown) {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : 'Expression summary failed'
            )
          }
        } finally {
          remaining -= 1
          if (!cancelled) setPendingCount(Math.max(0, remaining))
        }
      })
    }

    run()
    return () => {
      cancelled = true
    }
  }, [featureKey])

  const matrixIds = useMemo(() => {
    const ids = new Set<string>()
    for (const feature of features) {
      for (const mid of feature.matrixIds ?? []) ids.add(mid)
    }
    return [...ids].sort((a, b) => a.localeCompare(b))
  }, [featureKey, features])

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
