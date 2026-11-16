import assert from 'node:assert/strict'
import { groupFacetTermsForChips } from '@/lib/filter-type-theme'
import { isFacetFilteringTerm } from '@/lib/lens-catalog'
import type { FilteringTerm } from '@/lib/beacon/types'

const terms: FilteringTerm[] = [
  {
    type: 'alphanumeric',
    id: 'tissue.percentile:UBERON:0002107',
    scopes: ['genomicFeature'],
    label: 'Top 1% in liver (n=10)',
    values: ['90', '95', '99'],
  },
  {
    type: 'alphanumeric',
    id: 'tissue.percentile:UBERON:0000178',
    scopes: ['genomicFeature'],
    label: 'Top 1% in blood (n=5)',
    values: ['90', '95', '99'],
  },
  {
    type: 'alphanumeric',
    id: 'expression.percentile',
    scopes: ['genomicFeature'],
    label: 'Top expressed',
    values: ['90', '95', '99'],
  },
  {
    type: 'alphanumeric',
    id: 'feature.biotypeFamily',
    scopes: ['genomicFeature'],
    label: 'Gene type',
    values: ['lncRNA', 'protein_coding'],
  },
]

assert.equal(terms.every(isFacetFilteringTerm), true)
assert.equal(
  isFacetFilteringTerm({ type: 'alphanumeric', id: 'matrix.unit', scopes: ['matrix'] }),
  false
)

const facets = groupFacetTermsForChips('genomicFeature', terms)
assert.equal(facets.length, 3)
assert.equal(facets[0].key, 'facet|tissuePercentile')
assert.equal(facets[0].label, 'Top 1% in tissue')
assert.equal(facets[0].terms.length, 2)
assert.equal(facets[0].terms[0].id, 'tissue.percentile:UBERON:0000178') // blood before liver
assert.equal(facets[1].key, 'facet|term|Gene type'.replace('Gene type', 'feature.biotypeFamily'))
assert.equal(facets[2].key, 'facet|term|expression.percentile')

console.log('filter-type-theme.test.ts ok')
