import { isFeatureLensFilter } from '@/lib/beacon/filters'
import { valuedTermChips } from '@/lib/lens-catalog'
import type { FilteringTerm } from '@/lib/beacon/types'

const percentile: FilteringTerm = {
  id: 'expression.percentile',
  type: 'custom',
  label: 'Top expressed',
  scopes: ['genomicFeature'],
  values: ['90', '95', '99'],
}

const biotype: FilteringTerm = {
  id: 'feature.biotypeFamily',
  type: 'custom',
  label: 'Gene type',
  scopes: ['genomicFeature'],
  values: ['protein_coding', 'lncRNA'],
}

const tissue: FilteringTerm = {
  id: 'tissueHigh:UBERON:0002107',
  type: 'custom',
  label: 'High in liver',
  scopes: ['genomicFeature'],
}

const pctChips = valuedTermChips(percentile)
console.assert(pctChips != null && pctChips.length === 3)
const pct0 = pctChips![0]
console.assert(pct0.kind === 'expression')
if (pct0.kind === 'expression') {
  console.assert(pct0.operator === '>=')
  console.assert(pct0.value === '90')
}
console.assert(isFeatureLensFilter(pct0) === true)

const biotypeChips = valuedTermChips(biotype)
console.assert(biotypeChips != null && biotypeChips.length === 2)
const bio0 = biotypeChips![0]
console.assert(bio0.kind === 'alphanumeric')
if (bio0.kind === 'alphanumeric') {
  console.assert(bio0.id === 'feature.biotypeFamily')
  console.assert(bio0.value === 'protein_coding')
}
console.assert(isFeatureLensFilter(bio0) === true)

console.assert(valuedTermChips(tissue) === null)

const profileSource: FilteringTerm = {
  id: 'matrix.profileSource',
  type: 'custom',
  label: 'Profile source',
  scopes: ['matrix'],
  values: ['gtex', 'geo'],
}
const profileChips = valuedTermChips(profileSource)
console.assert(profileChips != null && profileChips.length === 2)
console.assert(profileChips![0].kind === 'custom')
if (profileChips![0].kind === 'custom') {
  console.assert(profileChips![0].id === 'matrix.profileSource:gtex')
}

console.log('lens-catalog-valued.test.ts: ok')
