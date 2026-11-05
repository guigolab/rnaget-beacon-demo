import assert from 'node:assert/strict'
import { groupCustomTermsForChips } from '@/lib/filter-type-theme'
import type { FilteringTerm } from '@/lib/beacon/types'

const terms: FilteringTerm[] = [
  {
    type: 'custom',
    id: 'tissueTop:UBERON:0002107',
    scopes: ['genomicFeature'],
    label: 'Top 1% in liver (n=10)',
  },
  {
    type: 'custom',
    id: 'tissueTop:UBERON:0000178',
    scopes: ['genomicFeature'],
    label: 'Top 1% in blood (n=5)',
  },
  {
    type: 'custom',
    id: 'tissuePresent:UBERON:0002107',
    scopes: ['genomicFeature'],
    label: 'Present in liver (n=100)',
  },
  {
    type: 'custom',
    id: 'tissuePresent:UBERON:0000178',
    scopes: ['genomicFeature'],
    label: 'Present in blood (n=80)',
  },
  {
    type: 'custom',
    id: 'expression.percentile',
    scopes: ['genomicFeature'],
    label: 'Top expressed',
    values: ['90', '95', '99'],
  },
  {
    type: 'custom',
    id: 'tissueHigh:UBERON:0002107',
    scopes: ['genomicFeature'],
    label: 'legacy high',
  },
]

const facets = groupCustomTermsForChips('genomicFeature', terms)
assert.equal(facets.length, 3)
assert.equal(facets[0].key, 'custom|tissueTop')
assert.equal(facets[0].label, 'Top 1% in tissue')
assert.equal(facets[0].terms.length, 2)
assert.equal(facets[0].terms[0].id, 'tissueTop:UBERON:0000178') // blood before liver
assert.equal(facets[1].key, 'custom|tissuePresent')
assert.equal(facets[1].label, 'Present in tissue')
assert.equal(facets[1].terms.length, 2)
assert.equal(facets[2].key, 'custom|term|expression.percentile')
assert.equal(facets[2].terms.length, 1)

console.log('filter-type-theme.test.ts ok')
