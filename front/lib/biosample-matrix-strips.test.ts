import assert from 'node:assert/strict'
import {
  UNLINKED_BIOSAMPLE_STRIP_ID,
  groupBiosamplesIntoMatrixStrips,
} from './sample-lens'
import type { Biosample } from './beacon/types'

const a: Biosample = {
  id: 'a',
  matrixIds: ['m2', 'm1'],
  sampleType: { label: 'Alpha' },
}
const b: Biosample = {
  id: 'b',
  matrixIds: ['m1'],
  sampleType: { label: 'Beta' },
}
const c: Biosample = {
  id: 'c',
  matrixIds: [],
  sampleType: { label: 'Gamma' },
}
const d: Biosample = {
  id: 'd',
  matrixIds: ['m2'],
  sampleType: { label: 'Delta' },
}

const strips = groupBiosamplesIntoMatrixStrips([a, b, c, d], null)
assert.equal(strips.length, 3)
assert.equal(strips[0].matrixId, 'm1')
assert.equal(strips[0].samples.length, 2)
assert.equal(strips[1].matrixId, 'm2')
assert.equal(strips[1].samples.length, 2)
assert.equal(strips[2].matrixId, UNLINKED_BIOSAMPLE_STRIP_ID)
assert.deepEqual(
  strips[2].samples.map((s) => s.id),
  ['c']
)

const focused = groupBiosamplesIntoMatrixStrips([a, b, d], 'm2')
assert.equal(focused[0].matrixId, 'm2')

console.log('biosample-matrix-strips.test.ts: ok')
