/**
 * Explore heatmap band paint via tissueTop probes + local presence.
 *
 * Presence is derived locally: feature.matrixIds ∩ ontology→matrix index
 * (from nested /matrices/{id}/filtering_terms). Only tissueTop is probed.
 *
 * Band map wire:
 * - 99 = matched tissueTop (≥99 within-tissue)
 * - 0 = locally present but not tissueTop (<99)
 * - missing key = none (not in matrix for that tissue)
 *
 * A column whose request fails is left out of `probedPairs` so other columns
 * stay painted and the failed cells can be retried.
 */

import { exploreMapPool } from '@/lib/async-pool'
import { isAbortError, listFeatures } from '@/lib/beacon/client'
import type { Feature, UiFilter } from '@/lib/beacon/types'
import {
  featureMatrixIdsForTissue,
  matrixIdsForOntology,
  ontologyCatalogKey,
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

function tissueTopFilter(ontologyId: string): UiFilter {
  return { kind: 'custom', id: `tissueTop:${ontologyId}` }
}

/** Module-level probe memo (package is immutable). Cap session growth. */
const PROBE_CACHE_MAX = 256
const probeCache = new Map<string, Set<string>>()

function probeCacheKey(filterId: string, featureIds: string[]): string {
  return `${filterId}\0${[...featureIds].sort().join(',')}`
}

export function resetExploreTissueBandCaches() {
  probeCache.clear()
}

async function probeFeatureIds(
  featureIds: string[],
  filter: UiFilter,
  signal?: AbortSignal
): Promise<Set<string>> {
  if (!featureIds.length) return new Set()
  const key = probeCacheKey(filter.id, featureIds)
  const cached = probeCache.get(key)
  if (cached) {
    // Refresh LRU order.
    probeCache.delete(key)
    probeCache.set(key, cached)
    return new Set(cached)
  }
  const page = await listFeatures(0, featureIds.length, {
    filters: [filter],
    featureIDList: featureIds.join(','),
    granularity: 'record',
    signal,
  })
  const hits = new Set(page.results.map((f) => f.id).filter(Boolean))
  probeCache.set(key, hits)
  while (probeCache.size > PROBE_CACHE_MAX) {
    const oldest = probeCache.keys().next().value
    if (oldest == null) break
    probeCache.delete(oldest)
  }
  return hits
}

/**
 * Local presence: any of the feature's matrixIds appears in the tissue's
 * matrix list from the ontology→matrix index.
 *
 * Returns null when the index is unavailable (caller should wait or fall
 * back to a tissuePresent probe). Empty index → absent.
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
  /** Pairs already painted; those ids are omitted from that column's request. */
  skipPairs?: Set<string>
  /**
   * Ontology ids already known present for every pending feature (seeded
   * tissueTop/tissuePresent list). Those columns skip local-present checks
   * and treat every pending id as present.
   */
  assumePresentOntologyIds?: readonly string[]
  /**
   * Ontology (lower) → matrixId[]. When set, presence is local (no
   * tissuePresent probe). When null/undefined, pending features are treated
   * as present so tissueTop alone still paints 99 vs none.
   */
  ontologyMatrixIndex?: Map<string, string[]> | null
  /**
   * Ontology ids whose bands are already known from the gene list fetch
   * (tissueTop-first seed → all 99; present continuation → all 0).
   * Those columns are painted without a probe.
   */
  seedBandByOntology?: ReadonlyMap<string, 99 | 0>
}): Promise<TissueBandProbe> {
  const features = opts.features.filter((f) => Boolean(f.id))
  const featureIds = features.map((f) => f.id)
  const out: FeatureTissueBandMap = new Map()
  const probedPairs = new Set<string>()
  const skip = opts.skipPairs
  const assumePresent = new Set(
    (opts.assumePresentOntologyIds ?? [])
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean)
  )
  const seedBands = opts.seedBandByOntology
  const index = opts.ontologyMatrixIndex

  if (!featureIds.length || !opts.columns.length) {
    return { bands: out, probedPairs }
  }

  await exploreMapPool(
    opts.columns,
    async (column) => {
      if (opts.signal?.aborted) return
      const oid = column.ontologyId
      if (!oid) return
      const pending = features.filter(
        (f) => !skip?.has(tissueBandPairKey(f.id, oid))
      )
      if (!pending.length) return

      // Unannotated matrix columns have no tissue summary row. Paint as none.
      if (isMatrixPseudoOntologyId(oid)) {
        for (const f of pending) probedPairs.add(tissueBandPairKey(f.id, oid))
        return
      }

      const seedBand = seedBands?.get(ontologyCatalogKey(oid))
      if (seedBand != null && assumePresent.has(oid.toLowerCase())) {
        for (const f of pending) {
          const bands = out.get(f.id) ?? {}
          bands[oid] = seedBand
          out.set(f.id, bands)
          probedPairs.add(tissueBandPairKey(f.id, oid))
        }
        return
      }

      const presentFeatures: Feature[] = []
      const unknownFeatures: Feature[] = []
      for (const f of pending) {
        if (assumePresent.has(oid.toLowerCase())) {
          presentFeatures.push(f)
          continue
        }
        const local = featurePresentInTissue(f, oid, index)
        if (local === null) unknownFeatures.push(f)
        else if (local) presentFeatures.push(f)
        else probedPairs.add(tissueBandPairKey(f.id, oid))
      }

      // Index not ready: leave pairs unprobed so a later pass can paint correctly.
      if (unknownFeatures.length && index == null) {
        return
      }

      if (!presentFeatures.length) return

      try {
        const topIds = await probeFeatureIds(
          presentFeatures.map((f) => f.id),
          tissueTopFilter(oid),
          opts.signal
        )
        if (opts.signal?.aborted) return
        for (const f of presentFeatures) {
          const bands = out.get(f.id) ?? {}
          bands[oid] = topIds.has(f.id) ? 99 : 0
          out.set(f.id, bands)
          probedPairs.add(tissueBandPairKey(f.id, oid))
        }
      } catch (err) {
        if (isAbortError(err) || opts.signal?.aborted) return
        // Leave this column unprobed. Sibling columns already recorded stay.
      }
    },
    opts.signal
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
