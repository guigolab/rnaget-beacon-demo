import { mapPool } from '@/lib/async-pool'
import {
  getFilteringTerms,
  isAbortError,
  listMatrices,
  probeMatrixBiosamples,
  type Feature,
  type FilteringTerm,
  type Matrix,
  type UiFilter,
} from '@/lib/beacon'
import { isTissueOrCellType } from '@/lib/biosample-ontology-grid'
import {
  isMatrixPseudoOntologyId,
  matrixIdFromPseudoOntology,
} from '@/lib/tissue-levels'

const PROBE_CONCURRENCY = 6
export const MATRIX_ID_CAP = 48
/** One page covers the demo package (12 matrices). */
const MATRIX_LIST_LIMIT = Math.min(20, MATRIX_ID_CAP)

export type TissueMatrixBiosampleCount = {
  matrix: Matrix
  biosampleCount: number
}

/** Case-fold ontology CURIEs for catalog lookups. */
export function ontologyCatalogKey(ontologyId: string): string {
  return ontologyId.trim().toLowerCase()
}

/**
 * Build ontologyId (lower) → matrixId[] from each matrix's biosample tissue terms.
 */
export function buildOntologyMatrixIndex(
  termsByMatrix: Map<string, FilteringTerm[]>
): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const [matrixId, terms] of termsByMatrix) {
    const mid = matrixId.trim()
    if (!mid) continue
    for (const term of terms) {
      if (!isTissueOrCellType(term)) continue
      const key = ontologyCatalogKey(term.id)
      if (!key) continue
      const list = index.get(key) ?? []
      if (!list.includes(mid)) list.push(mid)
      index.set(key, list)
    }
  }
  for (const [key, list] of index) {
    index.set(key, [...list].sort((a, b) => a.localeCompare(b)))
  }
  return index
}

/** Matrices whose filtering catalog lists this tissue (empty when unknown). */
export function matrixIdsForOntology(
  index: Map<string, string[]>,
  ontologyId: string
): string[] {
  return index.get(ontologyCatalogKey(ontologyId)) ?? []
}

/**
 * Feature membership ∩ tissue catalog matrices. Sorted for stable popover order.
 */
export function featureMatrixIdsForTissue(
  feature: Feature,
  ontologyMatrixIds: readonly string[]
): string[] {
  const member = new Set(
    (feature.matrixIds ?? []).map((id) => id.trim()).filter(Boolean)
  )
  if (!member.size || !ontologyMatrixIds.length) return []
  return ontologyMatrixIds
    .filter((id) => member.has(id))
    .sort((a, b) => a.localeCompare(b))
}

let matricesPromise: Promise<Matrix[]> | null = null
let ontologyIndexPromise: Promise<Map<string, string[]>> | null = null
const countByOntology = new Map<string, Promise<TissueMatrixBiosampleCount[]>>()

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
}

/** Session-cached matrix records (one GET /matrices page). */
export async function listCachedMatrices(
  signal?: AbortSignal
): Promise<Matrix[]> {
  if (!matricesPromise) {
    matricesPromise = listMatrices(0, MATRIX_LIST_LIMIT, {
      granularity: 'record',
    })
      .then((page) => {
        const byId = new Map<string, Matrix>()
        for (const matrix of page.results ?? []) {
          const id = matrix.matrixId?.trim()
          if (!id || byId.has(id)) continue
          byId.set(id, matrix)
          if (byId.size >= MATRIX_ID_CAP) break
        }
        return [...byId.values()].sort((a, b) =>
          (a.matrixId ?? '').localeCompare(b.matrixId ?? '')
        )
      })
      .catch((err: unknown) => {
        matricesPromise = null
        throw err
      })
  }
  const matrices = await matricesPromise
  throwIfAborted(signal)
  return matrices
}

/** Session-cached UBERON/EFO → matrix ids from each matrix filtering_terms. */
export async function getOntologyMatrixIndex(
  signal?: AbortSignal
): Promise<Map<string, string[]>> {
  if (!ontologyIndexPromise) {
    ontologyIndexPromise = (async () => {
      const matrices = await listCachedMatrices()
      const termsByMatrix = new Map<string, FilteringTerm[]>()
      await mapPool(matrices, PROBE_CONCURRENCY, async (matrix) => {
        const matrixId = matrix.matrixId?.trim()
        if (!matrixId) return
        try {
          const catalog = await getFilteringTerms(
            `/matrices/${encodeURIComponent(matrixId)}/filtering_terms`
          )
          termsByMatrix.set(matrixId, catalog.terms)
        } catch {
          termsByMatrix.set(matrixId, [])
        }
      })
      return buildOntologyMatrixIndex(termsByMatrix)
    })().catch((err: unknown) => {
      ontologyIndexPromise = null
      throw err
    })
  }
  const index = await ontologyIndexPromise
  throwIfAborted(signal)
  return index
}

export async function listAllMatrixIds(
  signal?: AbortSignal,
  cap = MATRIX_ID_CAP
): Promise<string[]> {
  const matrices = await listCachedMatrices(signal)
  return matrices
    .map((m) => m.matrixId?.trim())
    .filter((id): id is string => Boolean(id))
    .slice(0, cap)
}

function matrixFromCache(
  matrices: Matrix[],
  matrixId: string
): Matrix | null {
  const want = matrixId.trim()
  if (!want) return null
  return matrices.find((m) => m.matrixId?.trim() === want) ?? null
}

/**
 * Matrices that include this feature and the given biosample ontology
 * (or the single matrix for a ``matrix:`` pseudo column).
 */
export async function matricesForFeatureTissue(
  feature: Feature,
  ontologyId: string,
  _ontologyLabel: string,
  signal?: AbortSignal
): Promise<Matrix[]> {
  const memberIds = [
    ...new Set(
      (feature.matrixIds ?? []).map((id) => id.trim()).filter(Boolean)
    ),
  ]
  if (!memberIds.length) return []

  const matrices = await listCachedMatrices(signal)
  throwIfAborted(signal)

  let matchedIds: string[] = []
  if (isMatrixPseudoOntologyId(ontologyId)) {
    const mid = matrixIdFromPseudoOntology(ontologyId)
    if (mid && memberIds.includes(mid)) matchedIds = [mid]
  } else {
    const index = await getOntologyMatrixIndex(signal)
    matchedIds = featureMatrixIdsForTissue(
      feature,
      matrixIdsForOntology(index, ontologyId)
    )
  }

  if (!matchedIds.length) return []

  return matchedIds
    .map((id) => matrixFromCache(matrices, id))
    .filter((matrix): matrix is Matrix => Boolean(matrix?.matrixId))
    .sort((a, b) =>
      (a.name ?? a.matrixId ?? '').localeCompare(b.name ?? b.matrixId ?? '')
    )
}

/** Per-matrix biosample counts for a tissue / cell ontology column. */
export async function matrixBiosampleCountsForTissue(
  ontologyId: string,
  ontologyLabel: string,
  signal?: AbortSignal
): Promise<TissueMatrixBiosampleCount[]> {
  if (isMatrixPseudoOntologyId(ontologyId)) {
    const mid = matrixIdFromPseudoOntology(ontologyId)
    if (!mid) return []
    try {
      const matrices = await listCachedMatrices(signal)
      const matrix = matrixFromCache(matrices, mid)
      if (!matrix?.matrixId) return []
      const page = await probeMatrixBiosamples(mid, {
        granularity: 'count',
        signal,
      })
      const count = page.total ?? matrix.dimensions?.biosamples ?? 0
      return count > 0 ? [{ matrix, biosampleCount: count }] : []
    } catch (err) {
      if (isAbortError(err)) return []
      return []
    }
  }

  const cacheKey = ontologyCatalogKey(ontologyId)
  let pending = countByOntology.get(cacheKey)
  if (!pending) {
    pending = (async () => {
      const ontologyFilter: UiFilter = {
        kind: 'ontology',
        id: ontologyId,
        label: ontologyLabel,
      }
      const [matrices, index] = await Promise.all([
        listCachedMatrices(),
        getOntologyMatrixIndex(),
      ])
      const matrixIds = matrixIdsForOntology(index, ontologyId)
      if (!matrixIds.length) return []

      const hits = await mapPool(
        matrixIds,
        PROBE_CONCURRENCY,
        async (matrixId) => {
          try {
            const page = await probeMatrixBiosamples(matrixId, {
              filters: [ontologyFilter],
              granularity: 'count',
            })
            const count = page.total ?? 0
            if (!page.exists || count <= 0) return null
            return { matrixId, biosampleCount: count }
          } catch {
            return null
          }
        }
      )

      const matched = hits.filter(
        (hit): hit is { matrixId: string; biosampleCount: number } =>
          Boolean(hit)
      )
      if (!matched.length) return []

      return matched
        .map((hit) => {
          const matrix = matrixFromCache(matrices, hit.matrixId)
          if (!matrix?.matrixId) return null
          return { matrix, biosampleCount: hit.biosampleCount }
        })
        .filter((row): row is TissueMatrixBiosampleCount => Boolean(row))
        .sort(
          (a, b) =>
            b.biosampleCount - a.biosampleCount ||
            (a.matrix.name ?? a.matrix.matrixId ?? '').localeCompare(
              b.matrix.name ?? b.matrix.matrixId ?? ''
            )
        )
    })().catch((err: unknown) => {
      countByOntology.delete(cacheKey)
      throw err
    })
    countByOntology.set(cacheKey, pending)
  }

  try {
    const rows = await pending
    throwIfAborted(signal)
    return rows
  } catch (err) {
    if (isAbortError(err)) return []
    throw err
  }
}

/** Test seam: clear session caches. */
export function resetExploreTissueMatrixCaches() {
  matricesPromise = null
  ontologyIndexPromise = null
  countByOntology.clear()
}
