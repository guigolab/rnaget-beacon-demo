'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mapPool } from '@/lib/async-pool'
import { isAbortError } from '@/lib/beacon/client'
import type { Feature } from '@/lib/beacon/types'
import { BAND_ROW_CONCURRENCY } from '@/lib/expression-band'
import {
  bandCellKey,
  loadFeatureBandRow,
  matrixIdsForFeatures,
  seedAbsentCells,
  type FeatureBandCell,
} from '@/lib/feature-band-grid'

export type { FeatureBandCell }

export function useFeatureBandGrid(features: Feature[], focusMatrix?: string | null) {
  const featureKey = useMemo(
    () => features.map((f) => f.id).join('|'),
    [features]
  )
  const featuresRef = useRef(features)
  featuresRef.current = features

  const matrixIds = useMemo(() => {
    const all = matrixIdsForFeatures(features)
    if (focusMatrix) return all.filter((id) => id === focusMatrix)
    return all
  }, [featureKey, features, focusMatrix])

  const columnKey = matrixIds.join('|')

  const [cells, setCells] = useState<Map<string, FeatureBandCell>>(() => {
    const next = new Map<string, FeatureBandCell>()
    seedAbsentCells(next, features, matrixIds)
    return next
  })
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const fetchGenRef = useRef(0)

  useEffect(() => {
    const current = featuresRef.current
    const gen = ++fetchGenRef.current
    const controller = new AbortController()

    const seeded = new Map<string, FeatureBandCell>()
    seedAbsentCells(seeded, current, matrixIds)
    setCells(seeded)

    if (!current.length || !matrixIds.length) {
      setPendingCount(0)
      return () => controller.abort()
    }

    let cancelled = false
    setError('')
    let remaining = current.length
    setPendingCount(remaining)

    async function run() {
      await mapPool(current, BAND_ROW_CONCURRENCY, async (feature) => {
        if (cancelled || fetchGenRef.current !== gen) return
        try {
          const row = await loadFeatureBandRow(
            feature,
            matrixIds,
            controller.signal
          )
          if (cancelled || fetchGenRef.current !== gen) return
          setCells((prev) => {
            const next = new Map(prev)
            for (const [key, cell] of row) next.set(key, cell)
            return next
          })
        } catch (err: unknown) {
          if (isAbortError(err) || cancelled || fetchGenRef.current !== gen) return
          setError(err instanceof Error ? err.message : 'Band grid failed')
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
      controller.abort()
    }
  }, [featureKey, columnKey, matrixIds])

  function getCell(featureId: string, matrixId: string): FeatureBandCell | undefined {
    return cells.get(bandCellKey(featureId, matrixId))
  }

  return {
    loading: pendingCount > 0,
    pendingCount,
    error,
    matrixIds,
    getCell,
  }
}
