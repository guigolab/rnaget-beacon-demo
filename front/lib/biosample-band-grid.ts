import type { Biosample, Matrix } from '@/lib/beacon/types'
import {
  BAND_MATRIX_WINDOW_MAX,
  EXPRESSION_BANDS,
  bandCellKey,
  biosamplePercentileFilterId,
  matrixIdsForEntities,
  type BandCellValue,
  type ExpressionBand,
} from '@/lib/expression-band'
import { listBiosampleMatrices } from '@/lib/related-matrices'

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

export function applyBiosampleBandHits(
  cells: Map<string, BiosampleBandCell>,
  biosampleId: string,
  band: ExpressionBand,
  matrices: Matrix[],
  claimed: Set<string>
): void {
  for (const matrix of matrices) {
    const matrixId = matrix.matrixId
    if (!matrixId || claimed.has(matrixId)) continue
    claimed.add(matrixId)
    cells.set(bandCellKey(biosampleId, matrixId), {
      biosampleId,
      matrixId,
      band,
    })
  }
}

export function finalizeBiosampleUnmatched(
  cells: Map<string, BiosampleBandCell>,
  biosampleId: string,
  inWindow: string[],
  claimed: Set<string>
): void {
  for (const matrixId of inWindow) {
    if (claimed.has(matrixId)) continue
    cells.set(bandCellKey(biosampleId, matrixId), {
      biosampleId,
      matrixId,
      band: 'none',
    })
  }
}

export async function loadBiosampleBandRow(
  sample: Biosample,
  matrixWindow: string[],
  signal?: AbortSignal
): Promise<Map<string, BiosampleBandCell>> {
  const cells = new Map<string, BiosampleBandCell>()
  seedBiosampleAbsentCells(cells, [sample], matrixWindow)
  const inWindow = windowForBiosample(sample, matrixWindow)
  if (!inWindow.length) return cells

  const claimed = new Set<string>()
  const member = new Set(inWindow)
  const matrixIDList = matrixWindow.join(',')
  const limit = matrixWindow.length

  for (const band of EXPRESSION_BANDS) {
    if (signal?.aborted) break
    if (claimed.size >= inWindow.length) break
    const page = await listBiosampleMatrices(sample.id, {
      filters: [{ kind: 'custom', id: biosamplePercentileFilterId(band) }],
      matrixIDList,
      limit,
      signal,
    })
    const hits = (page.results ?? []).filter(
      (matrix) => matrix.matrixId && member.has(matrix.matrixId)
    )
    applyBiosampleBandHits(cells, sample.id, band, hits, claimed)
  }
  finalizeBiosampleUnmatched(cells, sample.id, inWindow, claimed)
  return cells
}
