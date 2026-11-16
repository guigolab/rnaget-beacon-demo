import assert from 'node:assert/strict'
import {
  matrixHref,
  matrixLensSearchParams,
  parseMatrixLensSearch,
  toBeaconFilter,
} from '@/lib/beacon/filters'

const unit = {
  kind: 'alphanumeric' as const,
  id: 'matrix.unit',
  value: 'TPM',
  label: 'Units = TPM',
}
const annotation = {
  kind: 'alphanumeric' as const,
  id: 'matrix.annotation',
  value: 'gencodeV24',
}
const assembly = {
  kind: 'alphanumeric' as const,
  id: 'matrix.assembly.name',
  value: 'GRCh38',
}
const source = {
  kind: 'alphanumeric' as const,
  id: 'matrix.source',
  value: 'gtex',
  label: 'Data source = GTEx',
}

const written = matrixLensSearchParams({
  filters: [unit, annotation, assembly, source],
})
assert.equal(written.get('matrix.unit'), 'TPM')
assert.equal(written.get('matrix.annotation'), 'gencodeV24')
assert.equal(written.get('matrix.assembly.name'), 'GRCh38')
assert.equal(written.get('matrix.source'), 'gtex')
const csv = written.get('filters') ?? ''
assert.ok(csv.includes('matrix.unit:=:TPM'))
assert.ok(csv.includes('matrix.source:=:gtex'))

const read = parseMatrixLensSearch(written)
assert.equal(read.matrix, null)
assert.deepEqual(
  read.matrixFilters
    .map((f) => (f.kind === 'alphanumeric' ? `${f.id}=${f.value}` : String(f)))
    .sort(),
  [
    'matrix.annotation=gencodeV24',
    'matrix.assembly.name=GRCh38',
    'matrix.source=gtex',
    'matrix.unit=TPM',
  ]
)

// CSV-only URL (no dotted keys) still round-trips.
const csvOnly = new URLSearchParams()
csvOnly.set(
  'filters',
  'matrix.unit:=:TPM,matrix.annotation:=:gencodeV24,matrix.assembly.name:=:GRCh38,matrix.source:=:gtex'
)
const fromCsv = parseMatrixLensSearch(csvOnly)
assert.equal(fromCsv.matrixFilters.length, 4)

for (const filter of [unit, annotation, assembly, source]) {
  const beacon = toBeaconFilter(filter)
  assert.equal(beacon.id, filter.id)
  assert.ok('operator' in beacon && beacon.operator === '=')
  assert.ok('value' in beacon && beacon.value === filter.value)
}

assert.equal(matrixHref('GTEx-v8-Liver'), '/matrices/?matrix=GTEx-v8-Liver')
assert.equal(
  matrixHref('GTEx-v8-Liver', 'featureIds=ENSG1'),
  '/matrices/?featureIds=ENSG1&matrix=GTEx-v8-Liver'
)

console.log('matrix-lens-filters.test.ts: ok')
