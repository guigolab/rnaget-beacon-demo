import { matrixFeaturesMatching } from '@/lib/beacon/client'
import type { Feature } from '@/lib/beacon/types'
import {
  BAND_MATRIX_WINDOW_MAX,
  FEATURE_PERCENTILE_THRESHOLDS,
  bandCellKey,
  featurePercentileFilter,
  matrixIdsForEntities,
  type BandCellValue,
  type FeaturePercentileThreshold,
} from '@/lib/expression-band'
import { featureTokens } from '@/lib/heatmap-expression'

export { bandCellKey }

export type FeatureBandCell = {
  featureId: string
  matrixId: string
  band: BandCellValue
}

export function matrixIdsForFeatures(
  features: Feature[],
  cap = BAND_MATRIX_WINDOW_MAX
): string[] {
  return matrixIdsForEntities(features, cap)
}

export function windowForFeature(
  feature: Feature,
  matrixWindow: string[]
): string[] {
  const member = new Set(feature.matrixIds ?? [])
  return matrixWindow.filter((id) => member.has(id))
}

/** Seed absent cells from membership; leave members unset until band queries finish. */
export function seedAbsentCells(
  cells: Map<string, FeatureBandCell>,
  features: Feature[],
  matrixWindow: string[]
): void {
  for (const feature of features) {
    const member = new Set(feature.matrixIds ?? [])
    for (const matrixId of matrixWindow) {
      if (member.has(matrixId)) continue
      cells.set(bandCellKey(feature.id, matrixId), {
        featureId: feature.id,
        matrixId,
        band: 'absent',
      })
    }
  }
}

export function featuresInMatrix(
  features: Feature[],
  matrixId: string
): Feature[] {
  return features.filter((feature) => (feature.matrixIds ?? []).includes(matrixId))
}

/** Index page features by any known token (wrapper id, native accession, aliases). */
export function featureLookupByToken(features: Feature[]): Map<string, Feature> {
  const byToken = new Map<string, Feature>()
  for (const feature of features) {
    for (const token of featureTokens(feature)) {
      if (!byToken.has(token)) byToken.set(token, feature)
    }
  }
  return byToken
}

export function applyColumnBandHits(
  cells: Map<string, FeatureBandCell>,
  matrixId: string,
  band: FeaturePercentileThreshold,
  hits: Feature[],
  byToken: Map<string, Feature>,
  claimed: Set<string>
): void {
  for (const hit of hits) {
    let pageFeature: Feature | undefined
    for (const token of featureTokens(hit)) {
      pageFeature = byToken.get(token)
      if (pageFeature) break
    }
    if (!pageFeature || claimed.has(pageFeature.id)) continue
    claimed.add(pageFeature.id)
    cells.set(bandCellKey(pageFeature.id, matrixId), {
      featureId: pageFeature.id,
      matrixId,
      band,
    })
  }
}

/** Remaining in-matrix members with no percentile-threshold hit default to none. */
export function finalizeColumnUnmatched(
  cells: Map<string, FeatureBandCell>,
  matrixId: string,
  members: Feature[],
  claimed: Set<string>
): void {
  for (const feature of members) {
    if (claimed.has(feature.id)) continue
    cells.set(bandCellKey(feature.id, matrixId), {
      featureId: feature.id,
      matrixId,
      band: 'none',
    })
  }
}

/**
 * Paint one matrix column for the current feature page. The nested features
 * route has no filters or ID list, so each threshold lists the `/features` root
 * with alphanumeric `expression.percentile >= N` (strongest first: 99 → 95 → 90),
 * narrowed to this matrix; page features are matched by id.
 */
export async function loadFeatureBandColumn(
  matrixId: string,
  features: Feature[],
  signal?: AbortSignal
): Promise<Map<string, FeatureBandCell>> {
  const cells = new Map<string, FeatureBandCell>()
  seedAbsentCells(cells, features, [matrixId])
  const members = featuresInMatrix(features, matrixId)
  if (!members.length) return cells

  const claimed = new Set<string>()
  const byToken = featureLookupByToken(members)

  for (const threshold of FEATURE_PERCENTILE_THRESHOLDS) {
    if (signal?.aborted) break
    if (claimed.size >= members.length) break
    const hits = await matrixFeaturesMatching(
      matrixId,
      [featurePercentileFilter(threshold)],
      signal
    )
    applyColumnBandHits(
      cells,
      matrixId,
      threshold,
      hits,
      byToken,
      claimed
    )
  }
  finalizeColumnUnmatched(cells, matrixId, members, claimed)
  return cells
}
