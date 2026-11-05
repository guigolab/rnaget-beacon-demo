import type { Biosample, ExpressionValue, Feature } from '@/lib/beacon/types'
import { cellKey } from '@/lib/heatmap-expression'

/** Ranked expression_values page size for first paint. */
export const SLICE_LIMIT = 200
/** Max heatmap rows derived from a ranked slice. */
export const SLICE_FEATURE_CAP = 12
/** Max heatmap columns derived from a ranked slice. */
export const SLICE_BIOSAMPLE_CAP = 24

export type SliceHeatmapAxes = {
  featureIds: string[]
  biosampleIds: string[]
  /** Sparse cell map for accepted feature rows (any biosample seen in the slice). */
  values: Map<string, number>
}

/**
 * Derive heatmap axes from a ranked expression_values page.
 * Feature/biosample order follows first appearance in `cells`.
 */
export function deriveSliceHeatmapAxes(
  cells: readonly ExpressionValue[],
  featureCap = SLICE_FEATURE_CAP,
  biosampleCap = SLICE_BIOSAMPLE_CAP
): SliceHeatmapAxes {
  const featureIds: string[] = []
  const featureSeen = new Set<string>()
  const values = new Map<string, number>()

  for (const cell of cells) {
    const featureId = cell.featureId?.trim()
    const biosampleId = cell.biosampleId?.trim()
    if (!featureId || !biosampleId || !Number.isFinite(cell.value)) continue

    if (!featureSeen.has(featureId)) {
      if (featureIds.length >= featureCap) continue
      featureSeen.add(featureId)
      featureIds.push(featureId)
    }
    values.set(cellKey(featureId, biosampleId), cell.value)
  }

  const biosampleIds: string[] = []
  const biosampleSeen = new Set<string>()
  for (const cell of cells) {
    const featureId = cell.featureId?.trim()
    const biosampleId = cell.biosampleId?.trim()
    if (!featureId || !biosampleId || !featureSeen.has(featureId)) continue
    if (biosampleSeen.has(biosampleId)) continue
    if (biosampleIds.length >= biosampleCap) break
    biosampleSeen.add(biosampleId)
    biosampleIds.push(biosampleId)
  }

  return { featureIds, biosampleIds, values }
}

/** Stub feature records so the grid can render before label enrichment. */
export function stubFeaturesFromIds(ids: readonly string[]): Feature[] {
  return ids.map((id) => ({
    id,
    genomicFeature: { featureIdentifier: { id } },
  }))
}

/** Stub biosample records so the grid can render before label enrichment. */
export function stubBiosamplesFromIds(ids: readonly string[]): Biosample[] {
  return ids.map((id) => ({ id }))
}

export function mergeRecordsById<T extends { id: string }>(
  stubs: readonly T[],
  enriched: readonly T[]
): T[] {
  if (!enriched.length) return stubs.length ? [...stubs] : []
  const byId = new Map<string, T>()
  for (const item of enriched) {
    const id = item.id?.trim()
    if (!id || byId.has(id)) continue
    byId.set(id, item)
  }
  return stubs.map((stub) => {
    const id = stub.id?.trim()
    return (id && byId.get(id)) || stub
  })
}

/** Whether another ranked page can still grow the capped axes. */
export function sliceAxesCanExtend(
  featureCount: number,
  biosampleCount: number,
  featureCap = SLICE_FEATURE_CAP,
  biosampleCap = SLICE_BIOSAMPLE_CAP
): boolean {
  return featureCount < featureCap || biosampleCount < biosampleCap
}

/** True when a newer page added at least one feature or biosample axis id. */
export function sliceAxesGrew(
  before: SliceHeatmapAxes,
  after: SliceHeatmapAxes
): boolean {
  return (
    after.featureIds.length > before.featureIds.length ||
    after.biosampleIds.length > before.biosampleIds.length
  )
}
