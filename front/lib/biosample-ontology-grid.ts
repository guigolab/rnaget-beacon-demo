import { mapPool } from '@/lib/async-pool'
import { probeMatrixBiosamples } from '@/lib/beacon/client'
import type { FilteringTerm, UiFilter } from '@/lib/beacon/types'
import { BAND_COLUMN_CONCURRENCY } from '@/lib/expression-band'

/** Prefer these tissues first in ontology heatmap rows. */
export const ONTOLOGY_CORE_TISSUES = [
  'UBERON:0000955',
  'UBERON:0002107',
  'UBERON:0002048',
  'UBERON:0000178',
] as const

const SAMPLE_STATUS_IDS = new Set(['EFO:0009654', 'EFO:0009655'])

/** Concurrent per-ontology count probes within one matrix column. */
export const ONTOLOGY_CELL_CONCURRENCY = 4

/** Cap matrix columns in the biosample ontology heatmap. */
export const ONTOLOGY_MATRIX_WINDOW_MAX = 32

export type OntologyRow = {
  id: string
  label: string
  type?: string
}

export type OntologyCellState = 'absent' | 'pending' | 'present'

export type OntologyGridCell = {
  ontologyId: string
  matrixId: string
  state: OntologyCellState
  count?: number
  exists?: boolean
}

/** Tissue / cell-type CURIEs used as ontology-heatmap rows (not sample status). */
export function isTissueOrCellOntologyId(ontologyId: string): boolean {
  const prefix = ontologyId.split(':', 1)[0]?.toUpperCase() ?? ''
  if (prefix !== 'UBERON' && prefix !== 'EFO') return false
  if (SAMPLE_STATUS_IDS.has(ontologyId)) return false
  return true
}

export function isTissueOrCellType(term: FilteringTerm): boolean {
  if (term.type !== 'UBERON' && term.type !== 'EFO') return false
  if (!isTissueOrCellOntologyId(term.id)) return false
  return term.scopes?.includes('biosample') ?? false
}

export function ontologyCellKey(ontologyId: string, matrixId: string): string {
  return `${ontologyId}\0${matrixId}`
}

/** Tissue/cell ontology ids present in a matrix filtering_terms catalog. */
export function tissueOntologyIds(terms: FilteringTerm[]): Set<string> {
  const ids = new Set<string>()
  for (const term of terms) {
    if (isTissueOrCellType(term)) ids.add(term.id)
  }
  return ids
}

export function membershipByMatrix(
  termsByMatrix: Map<string, FilteringTerm[]>
): Map<string, Set<string>> {
  const membership = new Map<string, Set<string>>()
  for (const [matrixId, terms] of termsByMatrix) {
    membership.set(matrixId, tissueOntologyIds(terms))
  }
  return membership
}

/**
 * Union of tissue/cell ontologies across matrices. CORE tissues first, then
 * label sort. When `restrictToIds` is set (active ontology filters), keep only
 * those ids that appear in the union.
 */
export function buildOntologyRows(
  termsByMatrix: Map<string, FilteringTerm[]>,
  restrictToIds?: Set<string> | null
): OntologyRow[] {
  const byId = new Map<string, OntologyRow>()
  for (const terms of termsByMatrix.values()) {
    for (const term of terms) {
      if (!isTissueOrCellType(term)) continue
      if (restrictToIds && !restrictToIds.has(term.id)) continue
      const prev = byId.get(term.id)
      if (prev) {
        if (!prev.label && term.label) prev.label = term.label
        continue
      }
      byId.set(term.id, {
        id: term.id,
        label: term.label?.trim() || term.id,
        type: term.type,
      })
    }
  }

  const coreOrder = new Map<string, number>(
    ONTOLOGY_CORE_TISSUES.map((id, index) => [id, index])
  )
  return [...byId.values()].sort((a, b) => {
    const ac = coreOrder.get(a.id) ?? 1000
    const bc = coreOrder.get(b.id) ?? 1000
    if (ac !== bc) return ac - bc
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
  })
}

/**
 * Tissue/cell ontology ids that should restrict heatmap rows.
 * Non-tissue ontologies (OBI, HP, …) stay as probe constraints only.
 */
export function ontologyFilterIdSet(filters: UiFilter[]): Set<string> | null {
  const ids = new Set<string>()
  for (const filter of filters) {
    if (filter.kind === 'ontology' && isTissueOrCellOntologyId(filter.id)) {
      ids.add(filter.id)
    }
  }
  return ids.size ? ids : null
}

/**
 * Filters for a count probe of one ontology row: row tissue ontology plus other
 * active filters. Other tissue ontologies are dropped (row already scopes tissue);
 * non-tissue ontologies (OBI, HP, …) are kept as AND constraints.
 */
export function probeFiltersForOntology(
  ontologyId: string,
  label: string | undefined,
  activeFilters: UiFilter[]
): UiFilter[] {
  const rest = activeFilters.filter((filter) => {
    if (filter.kind !== 'ontology') return true
    if (filter.id === ontologyId) return true
    return !isTissueOrCellOntologyId(filter.id)
  })
  if (rest.some((filter) => filter.kind === 'ontology' && filter.id === ontologyId)) {
    return rest
  }
  return [{ kind: 'ontology', id: ontologyId, label }, ...rest]
}

/**
 * Seed absent cells from filtering_terms membership. Member cells stay unset
 * (pending) until count probes finish.
 */
export function seedOntologyCells(
  cells: Map<string, OntologyGridCell>,
  rows: OntologyRow[],
  matrixIds: string[],
  membership: Map<string, Set<string>>
): void {
  for (const row of rows) {
    for (const matrixId of matrixIds) {
      const present = membership.get(matrixId)?.has(row.id) ?? false
      if (present) continue
      cells.set(ontologyCellKey(row.id, matrixId), {
        ontologyId: row.id,
        matrixId,
        state: 'absent',
      })
    }
  }
}

/** Paint one matrix column via count granularity on nested biosamples. */
export async function loadMatrixOntologyColumn(
  matrixId: string,
  rows: OntologyRow[],
  membership: Set<string>,
  activeFilters: UiFilter[],
  signal?: AbortSignal,
  concurrency = ONTOLOGY_CELL_CONCURRENCY
): Promise<Map<string, OntologyGridCell>> {
  const cells = new Map<string, OntologyGridCell>()
  const toProbe: OntologyRow[] = []

  for (const row of rows) {
    if (!membership.has(row.id)) {
      cells.set(ontologyCellKey(row.id, matrixId), {
        ontologyId: row.id,
        matrixId,
        state: 'absent',
      })
      continue
    }
    toProbe.push(row)
  }

  if (!toProbe.length) return cells

  await mapPool(toProbe, concurrency, async (row) => {
    if (signal?.aborted) return
    const page = await probeMatrixBiosamples(matrixId, {
      filters: probeFiltersForOntology(row.id, row.label, activeFilters),
      granularity: 'count',
      signal,
    })
    if (signal?.aborted) return
    const count = page.total ?? 0
    const exists = page.exists === true && count > 0
    cells.set(ontologyCellKey(row.id, matrixId), {
      ontologyId: row.id,
      matrixId,
      state: exists ? 'present' : 'absent',
      count,
      exists: page.exists,
    })
  })

  return cells
}

export { BAND_COLUMN_CONCURRENCY }
