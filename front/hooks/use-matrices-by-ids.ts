'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mapPool } from '@/lib/async-pool'
import { getMatrix, type Matrix } from '@/lib/beacon'
import { groupMatricesForCompare, type CompareBucket } from '@/lib/comparability'

const matrixCache = new Map<string, Matrix>()

export function useMatricesByIds(matrixIds: string[]) {
  const idKey = useMemo(() => [...matrixIds].sort().join('|'), [matrixIds])
  const [tick, setTick] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const fetchGenRef = useRef(0)

  useEffect(() => {
    if (!matrixIds.length) {
      setPendingCount(0)
      return
    }

    const missing = matrixIds.filter((id) => !matrixCache.has(id))
    if (!missing.length) {
      setPendingCount(0)
      return
    }

    const gen = ++fetchGenRef.current
    let cancelled = false
    setError('')
    setPendingCount(missing.length)

    async function run() {
      try {
        await mapPool(missing, 6, async (id) => {
          if (cancelled || fetchGenRef.current !== gen) return
          try {
            const matrix = await getMatrix(id)
            if (matrix?.matrixId) matrixCache.set(matrix.matrixId, matrix)
          } catch {
            /* skip single matrix failure */
          }
        })
        if (!cancelled && fetchGenRef.current === gen) {
          setTick((t) => t + 1)
        }
      } catch (err: unknown) {
        if (!cancelled && fetchGenRef.current === gen) {
          setError(err instanceof Error ? err.message : 'Failed to load matrices')
        }
      } finally {
        if (!cancelled && fetchGenRef.current === gen) setPendingCount(0)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [idKey, matrixIds])

  const matrices = useMemo(() => {
    void tick
    return matrixIds
      .map((id) => matrixCache.get(id))
      .filter((m): m is Matrix => m != null)
  }, [matrixIds, tick])

  const buckets = useMemo(() => groupMatricesForCompare(matrices), [matrices])

  return {
    matrices,
    buckets,
    loading: pendingCount > 0,
    pendingCount,
    error,
  }
}

export function resolveUnitBucket(
  buckets: CompareBucket[],
  activeKey: string | null | undefined
): CompareBucket | null {
  if (!buckets.length) return null
  if (activeKey) {
    const hit = buckets.find((b) => b.key === activeKey)
    if (hit) return hit
  }
  return buckets[0]
}
