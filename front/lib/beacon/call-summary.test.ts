import assert from 'node:assert/strict'
import { summarizeCall } from './call-summary'

const get = summarizeCall({
  method: 'GET',
  path: '/matrices?skip=0&limit=3&requestedGranularity=record&filters=OBI%3A0003090',
})
assert.equal(get.method, 'GET')
assert.equal(get.route, '/matrices')
assert.deepEqual(
  get.chips.map((c) => [c.kind, c.label, c.value]),
  [
    ['pagination', 'skip', '0'],
    ['pagination', 'limit', '3'],
    ['granularity', 'granularity', 'record'],
    ['ontology', 'OBI:0003090', undefined],
  ]
)

const post = summarizeCall({
  method: 'POST',
  path: '/matrices/GTEx-v8-Liver/expression_values',
  body: {
    meta: { apiVersion: 'v2.0.0' },
    query: {
      requestedGranularity: 'record',
      pagination: { skip: 0, limit: 5, nextPage: 'abc' },
      filters: [
        { id: 'tissue.percentile:UBERON:0002107', operator: '>=', value: '99' },
        { id: 'SO:0001217' },
      ],
      requestParameters: {
        expressionValue: {
          order: 'desc',
          minValue: 10,
          featureIDList: 'A,B,C,D',
        },
      },
    },
  },
})
assert.equal(post.method, 'POST')
assert.equal(post.route, '/matrices/GTEx-v8-Liver/expression_values')
const byLabel = new Map(post.chips.map((c) => [c.label, c]))
assert.equal(byLabel.get('nextPage')?.value, 'token')
assert.equal(byLabel.get('tissue.percentile:UBERON:0002107')?.kind, 'alphanumeric')
assert.equal(byLabel.get('tissue.percentile:UBERON:0002107')?.value, '>= 99')
assert.equal(byLabel.get('SO:0001217')?.kind, 'ontology')
assert.equal(byLabel.get('order')?.value, 'desc')
assert.equal(byLabel.get('minValue')?.value, '10')
assert.equal(byLabel.get('featureIDList')?.value, 'A, B +2')
assert.equal(byLabel.get('featureIDList')?.title, 'A, B, C, D')

console.log('call-summary.test.ts: ok')
