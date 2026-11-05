/**
 * Explore heatmap band paint via tissueTop / tissuePresent probes.
 *
 * For each ontology column, probe root `/features` with the feature ids that
 * are not yet painted: tissuePresent first, then tissueTop only for present
 * hits. Callers pass the visible columns and `skipPairs` so a new gene or a
 * newly scrolled column does not resend ids already probed.
 *
 * When the gene page already applied ``tissuePresent:{oid}`` (selected tissue
 * chips), pass those ids in ``assumePresentOntologyIds`` and only ``tissueTop``
 * is requested for those columns.
 *
 * Band map wire:
 * - 99 = matched tissueTop (≥99 within-tissue)
 * - 0 = matched tissuePresent but not tissueTop (<99)
 * - missing key = none (not in matrix for that tissue)
 *
 * A column whose request fails is left out of `probedPairs` so other columns
 * stay painted and the failed cells can be retried.
 */

import { mapPool } from '@/lib/async-pool'
import { isAbortError, listFeatures } from '@/lib/beacon/client'
import type { Feature, UiFilter } from '@/lib/beacon/types'
import type { TissueColumn } from '@/lib/tissue-levels'

const COLUMN_PROBE_CONCURRENCY = 2

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

function tissuePresentFilter(ontologyId: string): UiFilter {
  return { kind: 'custom', id: `tissuePresent:${ontologyId}` }
}

async function probeFeatureIds(
  featureIds: string[],
  filter: UiFilter,
  signal?: AbortSignal
): Promise<Set<string>> {
  if (!featureIds.length) return new Set()
  const page = await listFeatures(0, featureIds.length, {
    filters: [filter],
    featureIDList: featureIds.join(','),
    granularity: 'record',
    signal,
  })
  return new Set(page.results.map((f) => f.id).filter(Boolean))
}

/** Build featureId → { ontologyId → 99|0 } for the requested columns. */
export async function probeExploreTissueBands(opts: {
  features: Feature[]
  columns: TissueColumn[]
  signal?: AbortSignal
  /** Pairs already painted; those ids are omitted from that column's request. */
  skipPairs?: Set<string>
  /**
   * Ontology ids already AND-ed as tissuePresent on the gene page. Those
   * columns skip the present probe and treat every pending id as present.
   */
  assumePresentOntologyIds?: readonly string[]
}): Promise<TissueBandProbe> {
  const featureIds = opts.features.map((f) => f.id).filter(Boolean)
  const out: FeatureTissueBandMap = new Map()
  const probedPairs = new Set<string>()
  const skip = opts.skipPairs
  const assumePresent = new Set(
    (opts.assumePresentOntologyIds ?? [])
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean)
  )

  if (!featureIds.length || !opts.columns.length) {
    return { bands: out, probedPairs }
  }

  await mapPool(opts.columns, COLUMN_PROBE_CONCURRENCY, async (column) => {
    if (opts.signal?.aborted) return
    const oid = column.ontologyId
    if (!oid) return
    const pending = featureIds.filter(
      (fid) => !skip?.has(tissueBandPairKey(fid, oid))
    )
    if (!pending.length) return
    // Unannotated matrix columns have no tissue summary row. Paint them as none.
    if (oid.toLowerCase().startsWith('matrix:')) {
      for (const fid of pending) probedPairs.add(tissueBandPairKey(fid, oid))
      return
    }
    try {
      const skipPresent = assumePresent.has(oid.toLowerCase())
      const presentIds = skipPresent
        ? new Set(pending)
        : await probeFeatureIds(
            pending,
            tissuePresentFilter(oid),
            opts.signal
          )
      if (opts.signal?.aborted) return
      let topIds = new Set<string>()
      if (presentIds.size) {
        topIds = await probeFeatureIds(
          [...presentIds],
          tissueTopFilter(oid),
          opts.signal
        )
        if (opts.signal?.aborted) return
      }
      for (const fid of pending) {
        if (presentIds.has(fid)) {
          const bands = out.get(fid) ?? {}
          bands[oid] = topIds.has(fid) ? 99 : 0
          out.set(fid, bands)
        }
        probedPairs.add(tissueBandPairKey(fid, oid))
      }
    } catch (err) {
      if (isAbortError(err) || opts.signal?.aborted) return
      // Leave this column unprobed. Sibling columns already recorded stay.
    }
  })

  return { bands: out, probedPairs }
}

export function bandsForFeature(
  map: FeatureTissueBandMap | null | undefined,
  featureId: string
): Record<string, number> | undefined {
  if (!map) return undefined
  return map.get(featureId)
}
