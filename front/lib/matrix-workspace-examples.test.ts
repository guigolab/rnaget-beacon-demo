import assert from 'node:assert/strict'
import { matrixHeatmapFeatureExamples } from '@/lib/matrix-workspace'
import type { Feature, FilteringTerm } from '@/lib/beacon/types'

const terms: FilteringTerm[] = [
  {
    type: 'SO',
    id: 'SO:0000704',
    label: 'gene',
    scopes: ['genomicFeature'],
  },
]

const preview: Feature[] = [
  {
    id: 'feature-tp53',
    genomicFeature: {
      aliases: ['TP53'],
      featureIdentifier: { id: 'ENSG00000141510' },
    },
  },
]

const examples = matrixHeatmapFeatureExamples(terms, preview)
assert.ok(examples.some((e) => e.label === 'TP53' && e.filter.kind === 'symbol'))
assert.ok(examples.some((e) => e.filter.kind === 'ontology' && e.filter.id === 'SO:0000704'))

console.log('matrix-workspace-examples.test.ts ok')
