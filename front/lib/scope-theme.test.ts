import {
  entryTypeScope,
  groupHomeNamespaces,
  groupTermsByNamespaceScope,
  namespaceLabel,
  resourceAllowedInScope,
} from './scope-theme'
import { lensQueryPlaceholder } from '@/lib/lens-catalog'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'

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
console.assert(namespaceLabel('custom', 'biosample.preset:female+UBERON:1') === 'custom')
console.assert(namespaceLabel('alphanumeric', 'feature.resource') === 'resource')

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

const resources: FilteringResource[] = [
  { id: 'so', name: 'Sequence Ontology', nameSpacePrefix: 'SO' },
  { id: 'go', name: 'Gene Ontology', nameSpacePrefix: 'GO' },
  { id: 'hgnc', name: 'HUGO Gene Nomenclature Committee', nameSpacePrefix: 'HGNC' },
  { id: 'uberon', name: 'Uberon', nameSpacePrefix: 'UBERON' },
  { id: 'obi', name: 'Ontology for Biomedical Investigations', nameSpacePrefix: 'OBI' },
]

const home = groupHomeNamespaces([soGene, sex], resources)
const featurePrefixes = home
  .filter((g) => g.scope === 'genomicFeature')
  .map((g) => g.namespaceType)
  .sort()
console.assert(featurePrefixes.includes('SO'))
console.assert(featurePrefixes.includes('GO'))
console.assert(featurePrefixes.includes('HGNC'))
console.assert(!featurePrefixes.includes('symbol'), 'symbol is a term, not a resource')
const goHome = home.find((g) => g.key === 'GO|genomicFeature')
console.assert(goHome?.count === 0 && goHome.terms.length === 0)
const soHome = home.find((g) => g.key === 'SO|genomicFeature')
console.assert(soHome?.count === 1 && soHome.terms.length === 1)
const bioPrefixes = home.filter((g) => g.scope === 'biosample').map((g) => g.namespaceType)
console.assert(bioPrefixes.includes('UBERON'))
console.assert(bioPrefixes.includes('alphanumeric'))
console.assert(!bioPrefixes.includes('HGNC'))
const matrixPrefixes = home.filter((g) => g.scope === 'matrix').map((g) => g.namespaceType)
console.assert(matrixPrefixes.includes('SO'))
console.assert(matrixPrefixes.includes('OBI'))
console.assert(!matrixPrefixes.includes('symbol'))

console.assert(
  resourceAllowedInScope('genomicFeature', { id: 'go', nameSpacePrefix: 'GO' })
)
console.assert(
  resourceAllowedInScope('genomicFeature', { id: 'hgnc', nameSpacePrefix: 'HGNC' })
)
console.assert(
  !resourceAllowedInScope('biosample', { id: 'hgnc', nameSpacePrefix: 'HGNC' })
)
console.assert(
  !resourceAllowedInScope('matrix', { id: 'symbol', nameSpacePrefix: 'symbol' })
)
console.assert(
  resourceAllowedInScope('biosample', { id: 'uberon', nameSpacePrefix: 'UBERON' })
)

const symbolTerm: FilteringTerm = {
  type: 'alphanumeric',
  id: 'symbol',
  label: 'Gene symbol',
  scopes: ['genomicFeature'],
}
const symbolHome = groupHomeNamespaces([symbolTerm], resources).filter(
  (g) => g.scope === 'genomicFeature' && g.terms.some((t) => t.id === 'symbol')
)
console.assert(symbolHome.length === 1 && symbolHome[0].namespaceType === 'alphanumeric')
console.assert(
  lensQueryPlaceholder('feature', [symbolTerm], resources).startsWith('symbol:…'),
  'symbol term drives the placeholder'
)

console.log('scope-theme.test.ts: ok')
