import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'
import {
  exploreTissueColumnUniverse,
  filterTissueColumns,
  parseTissueTermLabel,
  sortFeaturesByTissueBand,
  tissueBandFromInfo,
  tissueBandSortRank,
  tissueColumnsFromBiosampleOntologyTerms,
  tissueColumnsFromTerms,
  tissueHighFilterId,
  tissueOntologyFromHighId,
} from './tissue-levels'

const parsed = parseTissueTermLabel('High in liver (n=235)')
console.assert(parsed.name === 'High in liver')
console.assert(parsed.nBiosamples === 235)
console.assert(parseTissueTermLabel('High in liver').nBiosamples === null)

const terms: FilteringTerm[] = [
  {
    id: tissueHighFilterId('UBERON:0002107'),
    type: 'custom',
    label: 'High in liver (n=235)',
    scopes: ['genomicFeature'],
  },
  {
    id: 'tissueSpecific:UBERON:0002107',
    type: 'custom',
    label: 'Specific to liver (n=235)',
    scopes: ['genomicFeature'],
  },
  {
    id: tissueHighFilterId('matrix:GSE107011'),
    type: 'custom',
    label: 'High in Unannotated (GSE107011) (n=114)',
    scopes: ['genomicFeature'],
  },
]

const cols = tissueColumnsFromTerms(terms)
console.assert(cols.length === 2)
console.assert(
  cols
    .map((c) => c.ontologyId)
    .sort()
    .join(',') === 'UBERON:0002107,matrix:GSE107011'
)
const liver = cols.find((c) => c.ontologyId === 'UBERON:0002107')
console.assert(liver?.nBiosamples === 235)
console.assert(liver?.label === 'liver')

const filters: UiFilter[] = [
  { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' },
]
console.assert(
  filterTissueColumns(cols, filters)
    .map((c) => c.ontologyId)
    .join(',') === 'UBERON:0002107'
)

console.assert(tissueBandFromInfo(undefined, 'UBERON:0002107') === 'none')
console.assert(tissueBandFromInfo({}, 'UBERON:0002107') === 'none')
console.assert(tissueBandFromInfo({ 'UBERON:0002107': 0 }, 'UBERON:0002107') === 0)
console.assert(tissueBandFromInfo({ 'UBERON:0002107': 99 }, 'UBERON:0002107') === 99)
console.assert(tissueBandFromInfo({ 'UBERON:0002107': 1 }, 'UBERON:0002107') === 0)

console.assert(tissueBandSortRank(99) < tissueBandSortRank(0))
console.assert(tissueBandSortRank(0) < tissueBandSortRank('none'))

const bandById: Record<string, Record<string, number>> = {
  a: { 'UBERON:0002107': 0 },
  b: { 'UBERON:0002107': 99 },
  c: {},
}
const features: Feature[] = [
  { id: 'a', genomicFeature: { aliases: ['ZZZ'] } },
  { id: 'b', genomicFeature: { aliases: ['AAA'] } },
  { id: 'c', genomicFeature: { aliases: ['MMM'] } },
]
const sorted = sortFeaturesByTissueBand(
  features,
  'UBERON:0002107',
  (f) => bandById[f.id]
)
console.assert(sorted.map((f) => f.id).join(',') === 'b,a,c')

console.assert(
  tissueOntologyFromHighId('tissueHigh:UBERON:0002107') === 'UBERON:0002107'
)
console.assert(
  tissueOntologyFromHighId('tissueHigh:matrix:GSE107011') === 'matrix:GSE107011'
)
console.assert(tissueOntologyFromHighId('tissueSpecific:UBERON:0002107') === null)

const biosampleTerms: FilteringTerm[] = [
  {
    id: 'UBERON:0000178',
    type: 'UBERON',
    label: 'blood',
    scopes: ['biosample'],
  },
  {
    id: 'UBERON:0002107',
    type: 'UBERON',
    label: 'liver',
    scopes: ['biosample'],
  },
  {
    id: 'EFO:0009654',
    type: 'EFO',
    label: 'reference sample',
    scopes: ['biosample'],
  },
]
const fromBio = tissueColumnsFromBiosampleOntologyTerms(biosampleTerms)
console.assert(fromBio.length === 2, 'status EFO excluded; blood+liver kept')
console.assert(fromBio.some((c) => c.ontologyId === 'UBERON:0000178'))

const bloodOnly = exploreTissueColumnUniverse(biosampleTerms, [
  { kind: 'ontology', id: 'UBERON:0000178', label: 'blood' },
])
console.assert(bloodOnly.length === 1)
console.assert(bloodOnly[0]?.ontologyId === 'UBERON:0000178')
console.assert(bloodOnly[0]?.label === 'blood')

const bloodNoCatalog = exploreTissueColumnUniverse([], [
  { kind: 'ontology', id: 'UBERON:0000178', label: 'blood' },
])
console.assert(
  bloodNoCatalog.length === 1,
  'active tissue filter synthesizes a column without tissueHigh terms'
)
console.assert(bloodNoCatalog[0]?.ontologyId === 'UBERON:0000178')

const allFromCatalog = exploreTissueColumnUniverse(biosampleTerms, [])
console.assert(allFromCatalog.length === 2)

console.log('tissue-levels.test.ts: ok')
