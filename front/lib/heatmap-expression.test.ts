import { indexExpression, nativeFeatureId } from './heatmap-expression'
import type { ExpressionValue, Feature } from '@/lib/beacon/types'

const feature: Feature = {
  id: 'wrap:TP53',
  featureIdentifier: { id: 'TP53', resource: 'gencode' },
    aliases: ['TP53']}

const rows: ExpressionValue[] = [
  {
    id: '1',
    matrixId: 'm1',
    featureId: 'TP53',
    biosampleId: 's1',
    value: 12.5},
]

const { values, unmatched } = indexExpression([feature], rows)
console.assert(unmatched.length === 0)
console.assert(values.get(`${nativeFeatureId(feature)}:s1`) === 12.5)
console.log('heatmap-expression.test.ts: ok')
