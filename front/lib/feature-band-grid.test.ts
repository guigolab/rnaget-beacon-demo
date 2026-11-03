import type { Feature, Matrix } from '@/lib/beacon/types'
import {
  applyBandHits,
  finalizeUnmatched,
  matrixIdsForFeatures,
  seedAbsentCells,
  windowForFeature,
  type FeatureBandCell,
} from './feature-band-grid'
import { bandCellKey } from './expression-band'

const f1: Feature = { id: 'feat-a', matrixIds: ['m1', 'm2', 'm3'] }
const f2: Feature = { id: 'feat-b', matrixIds: ['m2'] }

console.assert(matrixIdsForFeatures([f1, f2]).join(',') === 'm1,m2,m3')
console.assert(windowForFeature(f2, ['m1', 'm2', 'm3']).join(',') === 'm2')

const cells = new Map<string, FeatureBandCell>()
seedAbsentCells(cells, [f2], ['m1', 'm2', 'm3'])
console.assert(cells.get(bandCellKey('feat-b', 'm1'))?.band === 'absent')
console.assert(cells.get(bandCellKey('feat-b', 'm3'))?.band === 'absent')
console.assert(!cells.has(bandCellKey('feat-b', 'm2')))

const claimed = new Set<string>()
const hits: Matrix[] = [{ matrixId: 'm2' }]
applyBandHits(cells, 'feat-b', '80-100', hits, claimed)
console.assert(cells.get(bandCellKey('feat-b', 'm2'))?.band === '80-100')
console.assert(claimed.has('m2'))

finalizeUnmatched(cells, 'feat-a', ['m1', 'm3'], new Set(['m1']))
console.assert(cells.get(bandCellKey('feat-a', 'm3'))?.band === 'none')
console.assert(!cells.has(bandCellKey('feat-a', 'm1')))

console.log('feature-band-grid.test.ts: ok')
