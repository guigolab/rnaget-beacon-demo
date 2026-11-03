import { listMatrixBiosamples } from '@/lib/beacon/client'
import type { Biosample } from '@/lib/beacon/types'
import {
  BAND_MATRIX_WINDOW_MAX,
  EXPRESSION_BANDS,
  bandCellKey,
  biosamplePercentileFilterId,
  matrixIdsForEntities,
  type BandCellValue,
  type ExpressionBand,
} from '@/lib/expression-band'

export { bandCellKey as biosampleBandCellKey }

export type BiosampleBandCell = {
  biosampleId: string
  matrixId: string
  band: BandCellValue
}

export function matrixIdsForBiosamples(
  samples: Biosample[],
  cap = BAND_MATRIX_WINDOW_MAX
): string[] {
  return matrixIdsForEntities(samples, cap)
}

export function windowForBiosample(
  sample: Biosample,
  matrixWindow: string[]
): string[] {
  const member = new Set(sample.matrixIds ?? [])
  return matrixWindow.filter((id) => member.has(id))
}

export function seedBiosampleAbsentCells(
  cells: Map<string, BiosampleBandCell>,
  samples: Biosample[],
  matrixWindow: string[]
): void {
  for (const sample of samples) {
    const member = new Set(sample.matrixIds ?? [])
    for (const matrixId of matrixWindow) {
      if (member.has(matrixId)) continue
      cells.set(bandCellKey(sample.id, matrixId), {
        biosampleId: sample.id,
        matrixId,
        band: 'absent',
      })
    }
  }
}

export function biosamplesInMatrix(
  samples: Biosample[],
  matrixId: string
): Biosample[] {
  return samples.filter((sample) => (sample.matrixIds ?? []).includes(matrixId))
}

export function applyBiosampleColumnBandHits(
  cells: Map<string, BiosampleBandCell>,
  matrixId: string,
  band: ExpressionBand,
  hits: Biosample[],
  byId: Map<string, Biosample>,
  claimed: Set<string>
): void {
  for (const hit of hits) {
    const sample = byId.get(hit.id)
    if (!sample || claimed.has(sample.id)) continue
    claimed.add(sample.id)
    cells.set(bandCellKey(sample.id, matrixId), {
      biosampleId: sample.id,
      matrixId,
      band,
    })
  }
}

export function finalizeBiosampleColumnUnmatched(
  cells: Map<string, BiosampleBandCell>,
  matrixId: string,
  members: Biosample[],
  claimed: Set<string>
): void {
  for (const sample of members) {
    if (claimed.has(sample.id)) continue
    cells.set(bandCellKey(sample.id, matrixId), {
      biosampleId: sample.id,
      matrixId,
      band: 'none',
    })
  }
}

/**
 * Paint one matrix column for the current biosample page via
 * `POST /matrices/{id}/biosamples` + `biosampleIDList` +
 * `expression.detectedGenesPercentile.*`.
 */
export async function loadBiosampleBandColumn(
  matrixId: string,
  samples: Biosample[],
  signal?: AbortSignal
): Promise<Map<string, BiosampleBandCell>> {
  const cells = new Map<string, BiosampleBandCell>()
  seedBiosampleAbsentCells(cells, samples, [matrixId])
  const members = biosamplesInMatrix(samples, matrixId)
  if (!members.length) return cells

  const claimed = new Set<string>()
  const byId = new Map(members.map((sample) => [sample.id, sample]))
  const biosampleIDList = members.map((sample) => sample.id).join(',')
  const limit = Math.max(members.length, 1)

  for (const band of EXPRESSION_BANDS) {
    if (signal?.aborted) break
    if (claimed.size >= members.length) break
    const page = await listMatrixBiosamples(matrixId, 0, limit, {
      biosampleIDList,
      filters: [{ kind: 'custom', id: biosamplePercentileFilterId(band) }],
      signal,
    })
    applyBiosampleColumnBandHits(
      cells,
      matrixId,
      band,
      page.results ?? [],
      byId,
      claimed
    )
  }
  finalizeBiosampleColumnUnmatched(cells, matrixId, members, claimed)
  return cells
}
