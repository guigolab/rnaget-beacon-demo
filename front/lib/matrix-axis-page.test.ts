import assert from 'node:assert/strict'
import { appendAxisPage } from '@/lib/matrix-axis-page'

const first = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
]
const page = [
  { id: 'b', label: 'B2' },
  { id: 'c', label: 'C' },
  { id: '', label: 'skip' },
]
const merged = appendAxisPage(first, page)
assert.deepEqual(
  merged.map((item) => item.id),
  ['a', 'b', 'c']
)
assert.equal(merged[1]?.label, 'B')
assert.equal(appendAxisPage(first, [{ id: 'a', label: 'nope' }]), first)

console.log('matrix-axis-page.test.ts ok')
