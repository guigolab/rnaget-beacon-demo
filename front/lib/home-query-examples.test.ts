import assert from 'node:assert/strict'
import { collectionQuery } from '@/lib/beacon/query'
import type { FilteringTerm } from '@/lib/beacon/types'
import {
  buildHomeQueryExamples,
  examplesForTab,
  HOME_EXAMPLE_TABS,
} from '@/lib/home-query-examples'

const terms: FilteringTerm[] = [
  {
    id: 'feature.biotypeFamily',
    type: 'custom',
    label: 'Gene type',
    scopes: ['genomicFeature'],
    values: ['protein_coding'],
  },
  {
    id: 'expression.percentile',
    type: 'custom',
    scopes: ['genomicFeature'],
    values: ['90', '99'],
  },
  {
    id: 'UBERON:0002107',
    type: 'UBERON',
    label: 'liver',
    scopes: ['biosample'],
  },
  {
    id: 'UBERON:0000955',
    type: 'UBERON',
    label: 'brain',
    scopes: ['biosample'],
  },
  {
    id: 'matrix.unit',
    type: 'custom',
    scopes: ['matrix'],
    values: ['TPM'],
  },
  {
    id: 'matrix.profileSource',
    type: 'custom',
    scopes: ['matrix'],
    values: ['gtex', 'geo'],
  },
  {
    id: 'OBI:0003090',
    type: 'OBI',
    label: 'bulk RNA-seq assay',
    scopes: ['matrix'],
  },
]

const examples = buildHomeQueryExamples({
  terms,
  matrixIds: ['GTEx-v8-Liver', 'ENCSR622FSM'],
})

assert.ok(examples.length >= 10, 'expected a full example set')

for (const tab of HOME_EXAMPLE_TABS) {
  const subset = examplesForTab(examples, tab.id)
  assert.ok(subset.length > 0, `tab ${tab.id} should have examples`)
}

for (const example of examples) {
  if (!example.request) continue
  const built = collectionQuery(example.request.path, example.request.opts)
  assert.ok(
    built.method === 'GET' || built.method === 'POST',
    `${example.id}: method`
  )
  assert.ok(built.path.startsWith('/'), `${example.id}: path ${built.path}`)
  if (built.method === 'POST') {
    assert.ok(built.body?.query, `${example.id}: POST body.query`)
  }
}

const explore = examplesForTab(examples, 'explore')
assert.ok(
  !explore.some((e) => e.id === 'explore-genes'),
  'AND multi-symbol Explore example should be absent'
)
for (const example of explore) {
  assert.ok(example.href?.startsWith('/explore/'), `${example.id}: explore href`)
  assert.ok(example.request, `${example.id}: runnable request`)
  const built = collectionQuery(example.request!.path, example.request!.opts)
  assert.ok(built.path.startsWith('/features'), `${example.id}: features path`)
}

const exploreLiver = explore.find((e) => e.id === 'explore-liver')
assert.ok(
  (exploreLiver?.underlying?.length ?? 0) > 0,
  'explore-liver keeps tissuePresent continuation'
)

const matrixSingle = examples.find((e) => e.id === 'matrix-single')
assert.ok(matrixSingle?.request?.path.includes('GTEx-v8-Liver'))

const ev = examples.find((e) => e.id === 'ev-top')
assert.equal(
  ev?.request?.opts.requestParameters?.order,
  'desc',
  'expression order under requestParameters'
)

console.log('home-query-examples.test.ts: ok')
