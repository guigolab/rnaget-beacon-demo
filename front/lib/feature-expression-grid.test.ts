import {
  applySummaryRows,
  cellKey,
  chunkCsvTokens,
  chunkFeatureTokens,
  matrixSummaryBatches,
  type FeatureMatrixCell,
} from './feature-expression-grid'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Feature } from '@/lib/beacon/types'

function feature(id: string, native: string, matrixIds: string[]): Feature {
  return {
    id,
    matrixIds,
    genomicFeature: {
      featureIdentifier: { id: native, resource: 'gencode' },
      aliases: [native],
    },
  }
}

const f1 = feature('wrap:TP53', 'TP53', ['m1', 'm2'])
const f2 = feature('wrap:EGFR', 'EGFR', ['m1'])

console.assert(matrixSummaryBatches([f1, f2]).length === 2)

const many = Array.from({ length: 201 }, (_, i) =>
  feature(`wrap:g${i}`, `GENE${i}`, ['m1'])
)
const chunks = chunkFeatureTokens(many, 200).get('m1') ?? []
console.assert(chunks.length === 2)
console.assert(chunks[0].split(',').length === 200)
console.assert(chunks[1].split(',').length === 1)

const cells = new Map<string, FeatureMatrixCell>()
const rows: ExpressionSummary[] = [
  {
    id: 'm1:TP53:all',
    matrixId: 'm1',
    featureId: 'TP53',
    n: 10,
    median: 3.5,
  },
]
applySummaryRows(cells, [f1, f2], 'm1', rows)
console.assert(cells.get(cellKey('wrap:TP53', 'm1'))?.median === 3.5)
console.assert(cells.get(cellKey('wrap:EGFR', 'm1')) === undefined)

applySummaryRows(
  cells,
  [feature('wrap:ALB', 'ALB', ['m1'])],
  'm1',
  [{ id: 'x', matrixId: 'm1', featureId: 'wrap:ALB', n: 1, median: 1 }]
)
console.assert(cells.get(cellKey('wrap:ALB', 'm1'))?.median === 1)

console.assert(chunkCsvTokens(['a', 'b'], 10).join('|') === 'a,b')

console.log('feature-expression-grid.test.ts: ok')
