import { compareMatrices, groupMatricesForCompare } from './comparability'
import type { Matrix } from '@/lib/beacon/types'

function m(partial: Partial<Matrix>): Matrix {
  return partial as Matrix
}

const gtexA = m({
  matrixId: 'a',
  expressionUnitAndScale: { unit: 'TPM', scale: 'linear' },
  annotation: { source: 'gencode', version: 'v26' },
  assembly: { name: 'GRCh38' },
})

const gtexB = m({
  matrixId: 'b',
  expressionUnitAndScale: { unit: 'TPM', scale: 'linear' },
  annotation: { source: 'gencode', version: 'v26' },
  assembly: { name: 'GRCh38' },
})

const geo = m({
  matrixId: 'c',
  expressionUnitAndScale: { unit: 'TPM', scale: 'linear' },
  annotation: { source: 'ncbigene', version: '109' },
  assembly: { name: 'GRCh38.p13' },
})

console.assert(compareMatrices(gtexA, gtexB).level === 'direct')
console.assert(compareMatrices(gtexA, geo).level === 'bridged')

const buckets = groupMatricesForCompare([gtexA, gtexB, geo])
console.assert(buckets.length === 1 && buckets[0].matrices.length === 3)
console.assert(buckets[0].comparability.level === 'bridged')
