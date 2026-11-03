import type { Feature } from '@/lib/beacon/types'
import {
  applyColumnBandHits,
  featuresInMatrix,
  finalizeColumnUnmatched,
  matrixIdsForFeatures,
  seedAbsentCells,
  windowForFeature,
  type FeatureBandCell,
} from './feature-band-grid'
import { bandCellKey } from './expression-band'

const f1: Feature = {
  id: 'feat-a',
  genomicFeature: { featureIdentifier: { id: 'ENSG0001' } },
  matrixIds: ['m1', 'm2', 'm3'],
}
const f2: Feature = {
  id: 'feat-b',
  genomicFeature: { featureIdentifier: { id: 'ENSG0002' } },
  matrixIds: ['m2'],
}

console.assert(matrixIdsForFeatures([f1, f2]).join(',') === 'm1,m2,m3')
console.assert(windowForFeature(f2, ['m1', 'm2', 'm3']).join(',') === 'm2')
console.assert(featuresInMatrix([f1, f2], 'm2').length === 2)
console.assert(featuresInMatrix([f1, f2], 'm1').length === 1)

const cells = new Map<string, FeatureBandCell>()
seedAbsentCells(cells, [f2], ['m1', 'm2', 'm3'])
console.assert(cells.get(bandCellKey('feat-b', 'm1'))?.band === 'absent')
console.assert(cells.get(bandCellKey('feat-b', 'm3'))?.band === 'absent')
console.assert(!cells.has(bandCellKey('feat-b', 'm2')))

const claimed = new Set<string>()
const byToken = new Map<string, Feature>([
  ['feat-b', f2],
  ['ENSG0002', f2],
])
applyColumnBandHits(
  cells,
  'm2',
  '80-100',
  [{ id: 'feat-b', genomicFeature: { featureIdentifier: { id: 'ENSG0002' } } }],
  byToken,
  claimed
)
console.assert(cells.get(bandCellKey('feat-b', 'm2'))?.band === '80-100')
console.assert(claimed.has('feat-b'))

finalizeColumnUnmatched(cells, 'm1', [f1], new Set())
console.assert(cells.get(bandCellKey('feat-a', 'm1'))?.band === 'none')

console.log('feature-band-grid.test.ts: ok')
