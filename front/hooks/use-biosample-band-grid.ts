'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mapPool } from '@/lib/async-pool'
import { isAbortError } from '@/lib/beacon/client'
import type { Biosample } from '@/lib/beacon/types'
import { BAND_COLUMN_CONCURRENCY } from '@/lib/expression-band'
import {
  biosampleBandCellKey,
  loadBiosampleBandColumn,
  matrixIdsForBiosamples,
  seedBiosampleAbsentCells,
  type BiosampleBandCell,
} from '@/lib/biosample-band-grid'

export type { BiosampleBandCell }

export function useBiosampleBandGrid(
  samples: Biosample[],
  focusMatrix?: string | null
) {
  const sampleKey = useMemo(() => samples.map((s) => s.id).join('|'), [samples])
  const samplesRef = useRef(samples)
  samplesRef.current = samples

  const matrixIds = useMemo(() => {
    const all = matrixIdsForBiosamples(samples)
    if (focusMatrix) return all.filter((id) => id === focusMatrix)
    return all
  }, [sampleKey, samples, focusMatrix])

  const columnKey = matrixIds.join('|')

  const [cells, setCells] = useState<Map<string, BiosampleBandCell>>(() => {
    const next = new Map<string, BiosampleBandCell>()
    seedBiosampleAbsentCells(next, samples, matrixIds)
    return next
  })
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const fetchGenRef = useRef(0)

  useEffect(() => {
    const current = samplesRef.current
    const gen = ++fetchGenRef.current
    const controller = new AbortController()

    const seeded = new Map<string, BiosampleBandCell>()
    seedBiosampleAbsentCells(seeded, current, matrixIds)
    setCells(seeded)

    if (!current.length || !matrixIds.length) {
      setPendingCount(0)
      return () => controller.abort()
    }

    let cancelled = false
    setError('')
    let remaining = matrixIds.length
    setPendingCount(remaining)

    async function run() {
      await mapPool(matrixIds, BAND_COLUMN_CONCURRENCY, async (matrixId) => {
        if (cancelled || fetchGenRef.current !== gen) return
        try {
          const column = await loadBiosampleBandColumn(
            matrixId,
            current,
            controller.signal
          )
          if (cancelled || fetchGenRef.current !== gen) return
          setCells((prev) => {
            const next = new Map(prev)
            for (const [key, cell] of column) next.set(key, cell)
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
  }, [sampleKey, columnKey, matrixIds])

  function getCell(
    biosampleId: string,
    matrixId: string
  ): BiosampleBandCell | undefined {
    return cells.get(biosampleBandCellKey(biosampleId, matrixId))
  }

  return {
    loading: pendingCount > 0,
    pendingCount,
    error,
    matrixIds,
    getCell,
  }
}
