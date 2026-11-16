import assert from 'node:assert/strict'
import { matrixFilterGroups } from '@/lib/matrix-filter-groups'
import type { FilteringTerm } from '@/lib/beacon/types'

const terms: FilteringTerm[] = [
  { id: 'feature.biotypeFamily', type: 'alphanumeric', label: 'Gene type', scopes: ['genomicFeature'], values: ['protein_coding', 'lncRNA'] },
  { id: 'expression.percentile', type: 'alphanumeric', label: 'Top expressed', scopes: ['genomicFeature'], values: ['90', '99'] },
  { id: 'feature.resource', type: 'alphanumeric', label: 'Annotation resource', scopes: ['genomicFeature'], values: ['GenCode'] },
  { id: 'symbol', type: 'alphanumeric', label: 'Gene symbol', scopes: ['genomicFeature'], values: [] },
  { id: 'tissue.percentile:UBERON:0000178', type: 'alphanumeric', label: 'Top 1% in blood (n=761)', scopes: ['genomicFeature'], values: ['99'] },
  { id: 'GO:0000228', type: 'GO', label: 'nuclear chromosome', scopes: ['genomicFeature'] },
  { id: 'UBERON:0002107', type: 'UBERON', label: 'liver', scopes: ['biosample'] },
  { id: 'EFO:0002784', type: 'EFO', label: 'GM12878', scopes: ['biosample'] },
]

const feature = matrixFilterGroups('feature', terms)
assert.deepEqual(
  feature.map((g) => g.key),
  ['gene-type', 'top-expressed', 'top-in-tissue', 'annotation', 'ontology-GO']
)
const tissue = feature.find((g) => g.key === 'top-in-tissue')!
assert.equal(tissue.options[0].label, 'blood')
assert.equal(tissue.options[0].detail, 'n=761')
assert.ok(!feature.some((g) => g.options.some((o) => o.key === 'symbol')))

const biosample = matrixFilterGroups('biosample', terms)
assert.deepEqual(biosample.map((g) => g.label), ['Cell line & condition', 'Tissue'])
console.log('matrix-filter-groups.test.ts: ok')
