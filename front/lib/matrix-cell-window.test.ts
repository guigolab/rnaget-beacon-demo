import assert from 'node:assert/strict'
import {
  EXPRESSION_VALUE_PAGE_MAX,
  ID_LIST_CHAR_MAX,
  ID_LIST_TOKEN_MAX,
  chunkIdList,
  planCellWindowRequests,
} from '@/lib/matrix-cell-window'

const chunks = chunkIdList(['a', 'bb', 'ccc', 'dddd'], 2, 100)
assert.deepEqual(chunks, [
  ['a', 'bb'],
  ['ccc', 'dddd'],
])

const byChars = chunkIdList(['aaaa', 'bbbb', 'cccc'], 10, 9)
assert.deepEqual(byChars, [['aaaa', 'bbbb'], ['cccc']])

const features = Array.from({ length: 25 }, (_, i) => `F${i}`)
const biosamples = Array.from({ length: 90 }, (_, i) => `B${i}`)
const requests = planCellWindowRequests(features, biosamples)
assert.ok(requests.length > 1)
for (const request of requests) {
  assert.ok(request.featureIds.length <= ID_LIST_TOKEN_MAX)
  assert.ok(request.biosampleIds.length <= ID_LIST_TOKEN_MAX)
  assert.ok(request.featureIds.join(',').length <= ID_LIST_CHAR_MAX)
  assert.ok(request.biosampleIds.join(',').length <= ID_LIST_CHAR_MAX)
  assert.ok(request.featureIds.length * request.biosampleIds.length <= EXPRESSION_VALUE_PAGE_MAX)
}
const seen = new Set<string>()
for (const request of requests) {
  for (const featureId of request.featureIds) {
    for (const biosampleId of request.biosampleIds) seen.add(`${featureId}:${biosampleId}`)
  }
}
assert.equal(seen.size, features.length * biosamples.length)

assert.deepEqual(planCellWindowRequests([], ['b']), [])

console.log('matrix-cell-window.test.ts ok')
