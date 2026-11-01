import {
  entryTypeScope,
  groupTermsByNamespaceScope,
  namespaceLabel,
} from './scope-theme'
import type { FilteringTerm } from '@/lib/beacon/types'

function term(partial: Partial<FilteringTerm> & { id: string }): FilteringTerm {
  return partial
}

const soGene = term({
  type: 'SO',
  id: 'SO:0000704',
  scopes: ['genomicFeature'],
  label: 'gene',
})

const sex = term({
  type: 'alphanumeric',
  id: 'sex',
  scopes: ['biosample'],
  label: 'Sex',
  values: ['female', 'male'],
})

console.assert(entryTypeScope('feature') === 'genomicFeature')
console.assert(entryTypeScope('expressionValue') === 'matrix')
console.assert(entryTypeScope('biosample') === 'biosample')

console.assert(namespaceLabel('SO', 'SO:1') === 'Sequence Ontology')
console.assert(namespaceLabel('alphanumeric', 'genomicFeature.symbol') === 'symbol')
console.assert(namespaceLabel('custom', 'resource:gencode') === 'gencode')

const groups = groupTermsByNamespaceScope([soGene, sex])
console.assert(groups.length === 2)
const soGroup = groups.find((g) => g.key === 'SO|genomicFeature')
console.assert(soGroup?.count === 1 && soGroup.valueCount === 1)
const sexGroup = groups.find((g) => g.key === 'alphanumeric|biosample')
console.assert(sexGroup?.valueCount === 2)

const dual = term({
  type: 'SO',
  id: 'SO:0000704',
  scopes: ['genomicFeature', 'biosample'],
})
const dualGroups = groupTermsByNamespaceScope([dual])
console.assert(dualGroups.length === 2)

console.log('scope-theme.test.ts: ok')
