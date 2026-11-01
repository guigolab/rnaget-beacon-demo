import {
  matrixIdsFromSummaries,
  primarySummaryForMatrix,
  resolveSelectedFeature,
} from './gene-lens'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Feature } from '@/lib/beacon/types'

const f1: Feature = { id: 'a', matrixIds: ['m1', 'm2'] }
const f2: Feature = { id: 'b', matrixIds: ['m1'] }

console.assert(resolveSelectedFeature([f1, f2], null) === null)
console.assert(resolveSelectedFeature([f1], null)?.id === 'a')
console.assert(resolveSelectedFeature([f1, f2], 'b')?.id === 'b')

const summaries: ExpressionSummary[] = [
  { id: '1', matrixId: 'm1', featureId: 'x', n: 10, median: 5 },
  { id: '2', matrixId: 'm2', featureId: 'x', n: 3, median: 1 },
]
console.assert(matrixIdsFromSummaries(summaries).join(',') === 'm1,m2')

const grouped: ExpressionSummary[] = [
  { id: 'g', matrixId: 'm1', featureId: 'x', n: 2, median: 9, group: { id: 't', label: 'tissue' } },
  { id: 'all', matrixId: 'm1', featureId: 'x', n: 100, median: 4 },
]
console.assert(primarySummaryForMatrix(grouped)?.median === 4)

console.log('gene-lens.test.ts: ok')
