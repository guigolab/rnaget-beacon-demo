'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mapPool } from '@/lib/async-pool'
import {
  filterKey,
  getFilteringTerms,
  isAbortError,
  listMatrices,
} from '@/lib/beacon'
import type { FilteringTerm, UiFilter } from '@/lib/beacon/types'
import {
  BAND_COLUMN_CONCURRENCY,
  buildOntologyRows,
  loadMatrixOntologyColumn,
  membershipByMatrix,
  ontologyCellKey,
  ontologyFilterIdSet,
  ONTOLOGY_MATRIX_WINDOW_MAX,
  seedOntologyCells,
  type OntologyGridCell,
  type OntologyRow,
} from '@/lib/biosample-ontology-grid'

async function listAllMatrixIds(
  signal: AbortSignal,
  cap = ONTOLOGY_MATRIX_WINDOW_MAX
): Promise<string[]> {
  const ids: string[] = []
  let skip = 0
  const pageSize = Math.min(50, cap)
  while (ids.length < cap) {
    if (signal.aborted) break
    const page = await listMatrices(skip, pageSize, {
      granularity: 'record',
      signal,
    })
    const batch = (page.results ?? [])
      .map((m) => m.matrixId?.trim())
      .filter((id): id is string => Boolean(id))
    if (!batch.length) break
    for (const id of batch) {
      if (ids.includes(id)) continue
      ids.push(id)
      if (ids.length >= cap) break
    }
    skip += batch.length
    if (page.total != null && skip >= page.total) break
    if (batch.length < pageSize) break
  }
  return ids.sort((a, b) => a.localeCompare(b))
}

export function useBiosampleOntologyGrid(opts: {
  focusMatrix?: string | null
  activeFilters?: UiFilter[]
}) {
  const { focusMatrix = null, activeFilters = [] } = opts
  const filterKeyLine = useMemo(
    () => activeFilters.map((filter) => filterKey(filter)).join('|'),
    [activeFilters]
  )
  const filtersRef = useRef(activeFilters)
  filtersRef.current = activeFilters

  const [matrixIds, setMatrixIds] = useState<string[]>([])
  const [rows, setRows] = useState<OntologyRow[]>([])
  const [cells, setCells] = useState<Map<string, OntologyGridCell>>(new Map())
  const [pendingCount, setPendingCount] = useState(0)
  const [bootLoading, setBootLoading] = useState(true)
  const [error, setError] = useState('')
  const fetchGenRef = useRef(0)

  useEffect(() => {
    const gen = ++fetchGenRef.current
    const controller = new AbortController()
    let cancelled = false

    setBootLoading(true)
    setError('')
    setCells(new Map())
    setRows([])
    setMatrixIds([])
    setPendingCount(0)

    async function run() {
      try {
        let ids = await listAllMatrixIds(controller.signal)
        if (cancelled || fetchGenRef.current !== gen) return
        if (focusMatrix) {
          ids = ids.filter((id) => id === focusMatrix)
          if (!ids.length) ids = [focusMatrix]
        }

        const termsByMatrix = new Map<string, FilteringTerm[]>()
        await mapPool(ids, BAND_COLUMN_CONCURRENCY, async (matrixId) => {
          if (cancelled || fetchGenRef.current !== gen) return
          try {
            const catalog = await getFilteringTerms(
              `/matrices/${encodeURIComponent(matrixId)}/filtering_terms`
            )
            termsByMatrix.set(matrixId, catalog.terms)
          } catch (err: unknown) {
            if (isAbortError(err) || cancelled || fetchGenRef.current !== gen) {
              return
            }
            termsByMatrix.set(matrixId, [])
          }
        })
        if (cancelled || fetchGenRef.current !== gen) return

        const membership = membershipByMatrix(termsByMatrix)
        const restrict = ontologyFilterIdSet(filtersRef.current)
        const nextRows = buildOntologyRows(termsByMatrix, restrict)
        const seeded = new Map<string, OntologyGridCell>()
        seedOntologyCells(seeded, nextRows, ids, membership)

        setMatrixIds(ids)
        setRows(nextRows)
        setCells(seeded)
        setBootLoading(false)

        if (!ids.length || !nextRows.length) {
          setPendingCount(0)
          return
        }

        let remaining = ids.length
        setPendingCount(remaining)
        const filters = filtersRef.current

        await mapPool(ids, BAND_COLUMN_CONCURRENCY, async (matrixId) => {
          if (cancelled || fetchGenRef.current !== gen) return
          try {
            const memberSet = membership.get(matrixId) ?? new Set<string>()
            const column = await loadMatrixOntologyColumn(
              matrixId,
              nextRows,
              memberSet,
              filters,
              controller.signal
            )
            if (cancelled || fetchGenRef.current !== gen) return
            setCells((prev) => {
              const next = new Map(prev)
              for (const [key, cell] of column) next.set(key, cell)
              return next
            })
          } catch (err: unknown) {
            if (isAbortError(err) || cancelled || fetchGenRef.current !== gen) {
              return
            }
            setError(err instanceof Error ? err.message : 'Ontology grid failed')
          } finally {
            remaining -= 1
            if (!cancelled && fetchGenRef.current === gen) {
              setPendingCount(Math.max(0, remaining))
            }
          }
        })
      } catch (err: unknown) {
        if (isAbortError(err) || cancelled || fetchGenRef.current !== gen) return
        setError(err instanceof Error ? err.message : 'Ontology grid failed')
        setBootLoading(false)
        setPendingCount(0)
      }
    }

    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [focusMatrix, filterKeyLine])

  function getCell(
    ontologyId: string,
    matrixId: string
  ): OntologyGridCell | undefined {
    return cells.get(ontologyCellKey(ontologyId, matrixId))
  }

  const countBounds = useMemo(() => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const cell of cells.values()) {
      if (cell.state !== 'present' || cell.count == null) continue
      if (!Number.isFinite(cell.count) || cell.count <= 0) continue
      min = Math.min(min, cell.count)
      max = Math.max(max, cell.count)
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 1 }
    }
    return { min, max: max >= min ? max : min + 1 }
  }, [cells])

  return {
    loading: bootLoading || pendingCount > 0,
    bootLoading,
    pendingCount,
    error,
    matrixIds,
    rows,
    getCell,
    countBounds,
  }
}
