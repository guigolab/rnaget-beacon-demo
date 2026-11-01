import {
  featureDisplayLabel,
  featureSymbol,
  matrixIdsFromSummaries,
  matrixViewHref,
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

const accessionFirst: Feature = {
  id: 'feature-ENSG00000198886.2',
  genomicFeature: {
    aliases: ['ENSG00000198886', 'MT-ND4'],
    featureIdentifier: { id: 'ENSG00000198886.2', resource: 'gencode' },
  },
}
console.assert(featureSymbol(accessionFirst) === 'MT-ND4')
console.assert(featureDisplayLabel(accessionFirst) === 'MT-ND4')
console.assert(matrixViewHref('GTEx-v8-Liver', accessionFirst).includes('genes=MT-ND4'))

const symbolFirst: Feature = {
  id: 'feature-tp53',
  genomicFeature: { aliases: ['TP53'], featureIdentifier: { id: 'ENSG00000141510' } },
}
console.assert(featureDisplayLabel(symbolFirst) === 'TP53')

console.log('gene-lens.test.ts: ok')
