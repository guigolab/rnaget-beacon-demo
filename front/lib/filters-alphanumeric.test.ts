import assert from 'node:assert/strict'
import {
  catalogSearchParams,
  legacyCustomToFilter,
  matrixSourceFilter,
  needsPost,
  parseCatalogSearch,
  scopeOf,
  symbolFilter,
  tissuePercentileFilter,
  toBeaconFilter,
} from '@/lib/beacon/filters'
import { filterForTermValue, isFacetFilteringTerm, termToUiFilter } from '@/lib/lens-catalog'

// Wire form: every non-ontology filter is plain alphanumeric (id, operator, value).
assert.deepEqual(toBeaconFilter(symbolFilter('TP53')), {
  id: 'symbol',
  operator: '=',
  value: 'TP53',
})
assert.deepEqual(toBeaconFilter(tissuePercentileFilter('UBERON:0002107', '99')), {
  id: 'tissue.percentile:UBERON:0002107',
  operator: '>=',
  value: '99',
})
assert.deepEqual(toBeaconFilter(matrixSourceFilter('gtex')), {
  id: 'matrix.source',
  operator: '=',
  value: 'gtex',
})
assert.equal(needsPost([symbolFilter('TP53')]), true) // alphanumeric filters need POST
assert.equal(needsPost([tissuePercentileFilter('UBERON:0002107')]), true)
assert.equal(needsPost([matrixSourceFilter('gtex')]), true)

// Scopes: tissue percentile gates genes, matrix.source gates matrices.
assert.equal(scopeOf(tissuePercentileFilter('UBERON:0002107')), 'feature')
assert.equal(scopeOf(matrixSourceFilter('gtex')), 'matrix')

// URL round trip.
const params = catalogSearchParams({
  filters: [symbolFilter('ALB'), tissuePercentileFilter('UBERON:0002107', '95')],
  granularity: 'record',
})
const back = parseCatalogSearch(params).filters
assert.equal(back.length, 2)
assert.deepEqual(back[0], { kind: 'symbol', value: 'ALB' })
assert.deepEqual(back[1], {
  kind: 'expression',
  id: 'tissue.percentile:UBERON:0002107',
  operator: '>=',
  value: '95',
})
const src = parseCatalogSearch(new URLSearchParams('matrix.source=gtex')).filters
assert.deepEqual(src, [{ kind: 'alphanumeric', id: 'matrix.source', value: 'gtex' }])

// Legacy compact ids still open old links, but only as alphanumeric filters.
assert.deepEqual(legacyCustomToFilter('matrix.profileSource:gtex'), {
  kind: 'alphanumeric',
  id: 'matrix.source',
  value: 'gtex',
  label: undefined,
})
assert.equal(legacyCustomToFilter('tissueHigh:UBERON:0002107'), null)

// Catalog terms: facet terms are alphanumeric and pick `>=` thresholds.
const tissueTerm = {
  type: 'alphanumeric',
  id: 'tissue.percentile:UBERON:0002107',
  scopes: ['genomicFeature'],
  values: ['90', '95', '99'],
}
assert.equal(isFacetFilteringTerm(tissueTerm), true)
assert.deepEqual(termToUiFilter(tissueTerm), {
  kind: 'expression',
  id: 'tissue.percentile:UBERON:0002107',
  operator: '>=',
  value: '99',
  label: undefined,
})
assert.deepEqual(filterForTermValue(tissueTerm, '95', 'x'), {
  kind: 'expression',
  id: 'tissue.percentile:UBERON:0002107',
  operator: '>=',
  value: '95',
  label: 'x',
})
assert.equal(
  filterForTermValue({ type: 'alphanumeric', id: 'feature.biotypeFamily' }, 'lncRNA').kind,
  'alphanumeric'
)

console.log('filters-alphanumeric.test.ts: ok')
