/**
 * Explore heatmap bands: one Beacon boolean question per gene x tissue cell.
 *
 *   POST /features  requestedGranularity: boolean
 *     filters: symbol = <feature id>, feature.resource = <resource>,
 *              tissue.percentile:<tissue> >= 99
 *
 * `exists: true` means the gene is in the tissue's top 1% (band 99). The
 * feature id (e.g. ENSG00000163631.16 or 213) plus its resource identify the
 * exact gene row, so the answer is per row, not per symbol.
 *
 * Presence is derived locally: feature.matrixIds ∩ ontology→matrix index
 * (from matrix biosampleTypes on GET /matrices). Cells for tissues the gene is
 * not measured in are painted as absent with no request.
 *
 * Band map wire:
 * - 99 = boolean query matched (≥99 within-tissue)
 * - 0 = locally present but the query did not match (<99)
 * - missing key = none (not in matrix for that tissue)
 *
 * Answers are immutable (the package is immutable): they are cached and shared
 * between concurrent callers. A cell whose request fails is left out of
 * `probedPairs` so other cells stay painted and it can be retried. Results
 * stream through `onProgress`.
 */

import { withExploreProbeLimit } from '@/lib/async-pool'
import {
  BeaconError,
  isAbortError,
  listFeatures,
} from '@/lib/beacon/client'
import {
  FEATURE_RESOURCE_ID,
  symbolFilter,
  tissuePercentileFilter,
} from '@/lib/beacon/filters'
import { collectionQuery } from '@/lib/beacon/query'
import type { Feature, UiFilter } from '@/lib/beacon/types'
import {
  featureMatrixIdsForTissue,
  matrixIdsForOntology,
} from '@/lib/explore-tissue-matrices'
import { isMatrixPseudoOntologyId, type TissueColumn } from '@/lib/tissue-levels'

export type FeatureTissueBandMap = Map<string, Record<string, number>>

export type TissueBandProbe = {
  bands: FeatureTissueBandMap
  /** Pairs whose requests finished, including not-in-matrix. */
  probedPairs: Set<string>
}

export function tissueBandPairKey(featureId: string, ontologyId: string): string {
  return `${featureId}\0${ontologyId}`
}

export function mergeTissueBandMaps(
  current: FeatureTissueBandMap,
  incoming: FeatureTissueBandMap
): FeatureTissueBandMap {
  let changed = false
  const next = new Map(current)
  for (const [featureId, bands] of incoming) {
    if (!bands || !Object.keys(bands).length) continue
    const prev = next.get(featureId)
    next.set(featureId, prev ? { ...prev, ...bands } : { ...bands })
    changed = true
  }
  return changed ? next : current
}

/** Feature accession used as the `symbol` lookup key (213, ENSG00000163631.16). */
function featureLookupKey(feature: Feature): string {
  return (
    feature.featureIdentifier?.id?.trim() ||
    feature.id.replace(/^feature-/, '')
  )
}

/** The exact filters asked for one gene x tissue cell. */
export function tissueCellFilters(feature: Feature, ontologyId: string): UiFilter[] {
  const filters: UiFilter[] = [symbolFilter(featureLookupKey(feature))]
  const resource = feature.featureIdentifier?.resource?.trim()
  if (resource) {
    filters.push({ kind: 'alphanumeric', id: FEATURE_RESOURCE_ID, value: resource })
  }
  filters.push(tissuePercentileFilter(ontologyId, '99'))
  return filters
}

/** The Beacon request behind one cell (shown to users and sent by the probe). */
export function tissueCellRequest(feature: Feature, ontologyId: string) {
  return collectionQuery('/features', {
    filters: tissueCellFilters(feature, ontologyId),
    granularity: 'boolean',
    skip: 0,
    limit: 1,
  })
}

/** pairKey → is tissueTop (≥99). Immutable per package. */
const CELL_CACHE_MAX = 50000
const cellCache = new Map<string, boolean>()
const cellInflight = new Map<string, Promise<boolean>>()

export function resetExploreTissueBandCaches() {
  cellCache.clear()
  cellInflight.clear()
}

function rememberCell(key: string, top: boolean) {
  cellCache.delete(key)
  cellCache.set(key, top)
  while (cellCache.size > CELL_CACHE_MAX) {
    const oldest = cellCache.keys().next().value
    if (oldest == null) break
    cellCache.delete(oldest)
  }
}

const RATE_LIMIT_RETRIES = 4
const RATE_LIMIT_BACKOFF_MS = 250

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      },
      { once: true }
    )
  })
}

/** Ask the boolean question for one cell (the proxy rate-limits bursts: back off on 429). */
async function askCell(
  feature: Feature,
  oid: string,
  signal?: AbortSignal
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const page = await listFeatures(0, 1, {
        filters: tissueCellFilters(feature, oid),
        granularity: 'boolean',
        recordGroup: 'explore-tissue-cells',
      })
      return page.exists === true
    } catch (err) {
      const limited = err instanceof BeaconError && err.status === 429
      if (!limited || attempt >= RATE_LIMIT_RETRIES) throw err
      await delay(RATE_LIMIT_BACKOFF_MS * (attempt + 1), signal)
    }
  }
}

function probeCell(
  feature: Feature,
  oid: string,
  signal?: AbortSignal
): Promise<boolean> {
  const key = tissueBandPairKey(feature.id, oid)
  const known = cellCache.get(key)
  if (known != null) return Promise.resolve(known)
  const inflight = cellInflight.get(key)
  if (inflight) return inflight
  const pending: Promise<boolean> = withExploreProbeLimit(
    () => askCell(feature, oid, signal),
    signal
  )
    .then((top) => {
      rememberCell(key, top)
      return top
    })
    .finally(() => {
      if (cellInflight.get(key) === pending) cellInflight.delete(key)
    })
  cellInflight.set(key, pending)
  return pending
}

/**
 * Local presence: any of the feature's matrixIds appears in the tissue's
 * matrix list from the ontology→matrix index.
 *
 * Returns null when the index is unavailable (caller should wait). Empty
 * index → absent.
 */
export function featurePresentInTissue(
  feature: Feature,
  ontologyId: string,
  ontologyMatrixIndex: Map<string, string[]> | null | undefined
): boolean | null {
  if (!ontologyId || isMatrixPseudoOntologyId(ontologyId)) return false
  if (ontologyMatrixIndex == null) return null
  const matrixIds = matrixIdsForOntology(ontologyMatrixIndex, ontologyId)
  return featureMatrixIdsForTissue(feature, matrixIds).length > 0
}

/** Build featureId → { ontologyId → 99|0 } for the requested columns. */
export async function probeExploreTissueBands(opts: {
  features: Feature[]
  columns: TissueColumn[]
  signal?: AbortSignal
  /** Pairs already painted; those cells are not asked again. */
  skipPairs?: Set<string>
  /**
   * Ontology ids already known present for every pending feature (the gene
   * list was fetched with a tissue term). Local presence is skipped for them.
   */
  assumePresentOntologyIds?: readonly string[]
  /**
   * Ontology (lower) → matrixId[]. When null/undefined, pairs stay unprobed so
   * a later pass can distinguish absent (none) from <99.
   */
  ontologyMatrixIndex?: Map<string, string[]> | null
  /** Columns asked first (e.g. the focused / seeded tissue). */
  priorityOntologyIds?: readonly string[]
  /**
   * Called with newly resolved cells as they arrive (local results are
   * delivered synchronously before any request). The final return value still
   * contains everything.
   */
  onProgress?: (delta: TissueBandProbe) => void
}): Promise<TissueBandProbe> {
  const features = opts.features.filter((f) => Boolean(f.id))
  const out: FeatureTissueBandMap = new Map()
  const probedPairs = new Set<string>()
  let fresh: TissueBandProbe = { bands: new Map(), probedPairs: new Set() }

  if (!features.length || !opts.columns.length) {
    return { bands: out, probedPairs }
  }

  const skip = opts.skipPairs
  const assumePresent = new Set(
    (opts.assumePresentOntologyIds ?? [])
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean)
  )
  const index = opts.ontologyMatrixIndex

  const markProbed = (fid: string, oid: string) => {
    const key = tissueBandPairKey(fid, oid)
    probedPairs.add(key)
    fresh.probedPairs.add(key)
  }
  const setBand = (fid: string, oid: string, value: 99 | 0) => {
    const bands = out.get(fid) ?? {}
    bands[oid] = value
    out.set(fid, bands)
    const delta = fresh.bands.get(fid) ?? {}
    delta[oid] = value
    fresh.bands.set(fid, delta)
    markProbed(fid, oid)
  }
  const emit = () => {
    if (opts.signal?.aborted || !opts.onProgress) {
      fresh = { bands: new Map(), probedPairs: new Set() }
      return
    }
    if (!fresh.probedPairs.size && !fresh.bands.size) return
    const delta = fresh
    fresh = { bands: new Map(), probedPairs: new Set() }
    opts.onProgress(delta)
  }

  // Pass 1 (synchronous, no network): absent / cached cells.
  const jobs: { oid: string; feature: Feature }[] = []
  for (const column of opts.columns) {
    const oid = column.ontologyId
    if (!oid) continue
    const assumed = assumePresent.has(oid.toLowerCase())
    for (const f of features) {
      if (skip?.has(tissueBandPairKey(f.id, oid))) continue
      // Unannotated matrix columns have no tissue summary row. Paint as none.
      if (isMatrixPseudoOntologyId(oid)) {
        markProbed(f.id, oid)
        continue
      }
      const present = assumed ? true : featurePresentInTissue(f, oid, index)
      if (present === null) continue // index not ready: leave unprobed
      if (!present) {
        markProbed(f.id, oid)
        continue
      }
      const cached = cellCache.get(tissueBandPairKey(f.id, oid))
      if (cached != null) setBand(f.id, oid, cached ? 99 : 0)
      else jobs.push({ oid, feature: f })
    }
  }
  emit()
  if (!jobs.length) return { bands: out, probedPairs }

  const priority = new Set(
    (opts.priorityOntologyIds ?? []).map((id) => id.trim().toLowerCase())
  )
  if (priority.size) {
    jobs.sort(
      (a, b) =>
        Number(priority.has(b.oid.toLowerCase())) -
        Number(priority.has(a.oid.toLowerCase()))
    )
  }

  /**
   * Shared in-flight work may reject with an AbortError that belongs to a
   * previous (superseded) probe run; retry once when ours is still live.
   */
  const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      if (isAbortError(err) && !opts.signal?.aborted) return fn()
      throw err
    }
  }

  await Promise.all(
    jobs.map(async ({ oid, feature }) => {
      try {
        const top = await retry(() => probeCell(feature, oid, opts.signal))
        if (opts.signal?.aborted) return
        setBand(feature.id, oid, top ? 99 : 0)
        emit()
      } catch {
        // Leave this cell unprobed; siblings stay painted.
      }
    })
  )

  return { bands: out, probedPairs }
}

export function bandsForFeature(
  map: FeatureTissueBandMap | null | undefined,
  featureId: string
): Record<string, number> | undefined {
  if (!map) return undefined
  return map.get(featureId)
}
