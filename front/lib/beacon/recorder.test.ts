import assert from 'node:assert/strict'
import { getRecentBeaconCalls, isRecordLookupPath, recordBeaconCall } from './recorder'

assert.equal(isRecordLookupPath('/features/ENSG1'), true)
assert.equal(isRecordLookupPath('/features/ENSG1?skip=0&limit=1'), true)
assert.equal(isRecordLookupPath('/features/ENSG1/matrices'), false)
assert.equal(isRecordLookupPath('/features'), false)

recordBeaconCall({ method: 'POST', path: '/matrices/M/expression_values', body: {} })
for (let i = 0; i < 40; i++) recordBeaconCall({ method: 'GET', path: `/features/F${i}?limit=1` })
const calls = getRecentBeaconCalls()
assert.equal(calls.length, 2, 'lookup burst takes one slot')
assert.equal(calls[0].repeat, 40)
assert.equal(calls[0].path, '/features/F39?limit=1')
assert.equal(calls[1].path, '/matrices/M/expression_values')

// Per-cell probes share a group: they fold into one entry with the latest body.
for (let i = 0; i < 25; i++) {
  recordBeaconCall({
    method: 'POST',
    path: '/features',
    body: { n: i },
    group: 'explore-tissue-cells',
  })
}
const grouped = getRecentBeaconCalls()
assert.equal(grouped[0].repeat, 25)
assert.deepEqual(grouped[0].body, { n: 24 })
assert.equal(grouped.length, 3, 'probe burst takes one slot')

console.log('recorder.test.ts: ok')
