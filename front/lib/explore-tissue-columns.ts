/**
 * Explore heatmap column resolution: sync tissue-id narrow, then optional
 * biosample constraint probes via nested `/matrices/{id}/biosamples` counts.
 */

import { mapPool } from '@/lib/async-pool'
import {
  isAbortError,
  probeMatrixBiosamples,
  type FilteringTerm,
  type UiFilter,
} from '@/lib/beacon'
import {
  isTissueOrCellOntologyId,
  probeFiltersForOntology,
} from '@/lib/biosample-ontology-grid'
import { listAllMatrixIds } from '@/lib/explore-tissue-matrices'
import {
  exploreTissueColumnUniverse,
  isMatrixPseudoOntologyId,
  matrixIdFromPseudoOntology,
  type TissueColumn,
} from '@/lib/tissue-levels'

const COLUMN_PROBE_CONCURRENCY = 4
const MATRIX_PROBE_CONCURRENCY = 6

/** UBERON/EFO ontology filters seed columns / tissuePresent. */
export function isExploreTissueSelectorFilter(filter: UiFilter): boolean {
  return filter.kind === 'ontology' && isTissueOrCellOntologyId(filter.id)
}

/** Split biosample lens filters into tissue selectors vs other constraints. */
export function partitionExploreBiosampleFilters(filters: UiFilter[]): {
  tissueFilters: UiFilter[]
  constraintFilters: UiFilter[]
} {
  const tissueFilters: UiFilter[] = []
  const constraintFilters: UiFilter[] = []
  for (const filter of filters) {
    if (isExploreTissueSelectorFilter(filter)) tissueFilters.push(filter)
    else constraintFilters.push(filter)
  }
  return { tissueFilters, constraintFilters }
}

/** Beacon filters for one column under active non-tissue constraints. */
export function probeFiltersForTissueColumn(
  column: TissueColumn,
  constraintFilters: UiFilter[]
): UiFilter[] {
  if (isMatrixPseudoOntologyId(column.ontologyId)) {
    return constraintFilters
  }
  return probeFiltersForOntology(
    column.ontologyId,
    column.label,
    constraintFilters
  )
}

async function sumBiosampleCountForColumn(
  column: TissueColumn,
  constraintFilters: UiFilter[],
  matrixIds: string[],
  signal?: AbortSignal
): Promise<number> {
  if (isMatrixPseudoOntologyId(column.ontologyId)) {
    const mid = matrixIdFromPseudoOntology(column.ontologyId)
    if (!mid) return 0
    try {
      const page = await probeMatrixBiosamples(mid, {
        filters: constraintFilters.length ? constraintFilters : undefined,
        granularity: 'count',
        signal,
      })
      return page.total ?? 0
    } catch (err) {
      if (isAbortError(err)) return 0
      throw err
    }
  }

  const filters = probeFiltersForTissueColumn(column, constraintFilters)
  const counts = await mapPool(
    matrixIds,
    MATRIX_PROBE_CONCURRENCY,
    async (matrixId) => {
      if (signal?.aborted) return 0
      try {
        const page = await probeMatrixBiosamples(matrixId, {
          filters,
          granularity: 'count',
          signal,
        })
        return page.total ?? 0
      } catch (err) {
        if (isAbortError(err)) return 0
        return 0
      }
    }
  )
  return counts.reduce((sum, n) => sum + n, 0)
}

/** Keep columns with positive probed totals; set ``nBiosamples`` from the sum. */
export function columnsWithProbedCounts(
  columns: TissueColumn[],
  totals: ReadonlyMap<string, number>
): TissueColumn[] {
  const out: TissueColumn[] = []
  for (const column of columns) {
    const total = totals.get(column.ontologyId) ?? 0
    if (total <= 0) continue
    out.push({ ...column, nBiosamples: total })
  }
  return out
}

/**
 * Resolve Explore heatmap columns. When non-tissue constraints are set, probe
 * nested biosample counts and keep columns with sum &gt; 0 (n from probes).
 */
export async function resolveExploreTissueColumns(opts: {
  terms: FilteringTerm[]
  biosampleFilters: UiFilter[]
  signal?: AbortSignal
  /** Test seam: override per-column biosample sum. */
  probeColumnCount?: (
    column: TissueColumn,
    constraintFilters: UiFilter[],
    matrixIds: string[],
    signal?: AbortSignal
  ) => Promise<number>
  listMatrixIds?: (signal?: AbortSignal) => Promise<string[]>
}): Promise<TissueColumn[]> {
  const { constraintFilters } = partitionExploreBiosampleFilters(
    opts.biosampleFilters
  )
  const columns = exploreTissueColumnUniverse(opts.terms, opts.biosampleFilters)

  if (!constraintFilters.length) return columns
  if (opts.signal?.aborted) return columns
  if (!columns.length) return []

  const listIds = opts.listMatrixIds ?? listAllMatrixIds
  const matrixIds = await listIds(opts.signal)
  if (opts.signal?.aborted) return columns
  if (!matrixIds.length) return []

  const probe = opts.probeColumnCount ?? sumBiosampleCountForColumn
  const probed = await mapPool(
    columns,
    COLUMN_PROBE_CONCURRENCY,
    async (column): Promise<TissueColumn | null> => {
      if (opts.signal?.aborted) return null
      try {
        const total = await probe(
          column,
          constraintFilters,
          matrixIds,
          opts.signal
        )
        if (total <= 0) return null
        const next: TissueColumn = { ...column, nBiosamples: total }
        return next
      } catch (err) {
        if (isAbortError(err) || opts.signal?.aborted) return null
        throw err
      }
    }
  )

  if (opts.signal?.aborted) return columns
  return probed.filter((col): col is TissueColumn => col != null)
}
