import type { Feature, Matrix } from '@/lib/beacon/types'
import {
  BAND_MATRIX_WINDOW_MAX,
  EXPRESSION_BANDS,
  bandCellKey,
  featurePercentileFilterId,
  matrixIdsForEntities,
  type BandCellValue,
  type ExpressionBand,
} from '@/lib/expression-band'
import { listFeatureMatrices } from '@/lib/related-matrices'

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

export function applyBandHits(
  cells: Map<string, FeatureBandCell>,
  featureId: string,
  band: ExpressionBand,
  matrices: Matrix[],
  claimed: Set<string>
): void {
  for (const matrix of matrices) {
    const matrixId = matrix.matrixId
    if (!matrixId || claimed.has(matrixId)) continue
    claimed.add(matrixId)
    cells.set(bandCellKey(featureId, matrixId), {
      featureId,
      matrixId,
      band,
    })
  }
}

/** Remaining in-window members with no band hit default to none. */
export function finalizeUnmatched(
  cells: Map<string, FeatureBandCell>,
  featureId: string,
  inWindow: string[],
  claimed: Set<string>
): void {
  for (const matrixId of inWindow) {
    if (claimed.has(matrixId)) continue
    cells.set(bandCellKey(featureId, matrixId), {
      featureId,
      matrixId,
      band: 'none',
    })
  }
}

export async function loadFeatureBandRow(
  feature: Feature,
  matrixWindow: string[],
  signal?: AbortSignal
): Promise<Map<string, FeatureBandCell>> {
  const cells = new Map<string, FeatureBandCell>()
  seedAbsentCells(cells, [feature], matrixWindow)
  const inWindow = windowForFeature(feature, matrixWindow)
  if (!inWindow.length) return cells

  const claimed = new Set<string>()
  const member = new Set(inWindow)
  const matrixIDList = matrixWindow.join(',')
  const limit = matrixWindow.length

  for (const band of EXPRESSION_BANDS) {
    if (signal?.aborted) break
    if (claimed.size >= inWindow.length) break
    const page = await listFeatureMatrices(feature.id, {
      filters: [{ kind: 'custom', id: featurePercentileFilterId(band) }],
      matrixIDList,
      limit,
      signal,
    })
    const hits = (page.results ?? []).filter(
      (matrix) => matrix.matrixId && member.has(matrix.matrixId)
    )
    applyBandHits(cells, feature.id, band, hits, claimed)
  }
  finalizeUnmatched(cells, feature.id, inWindow, claimed)
  return cells
}
