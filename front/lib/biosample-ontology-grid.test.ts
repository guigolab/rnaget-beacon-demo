import type { FilteringTerm, UiFilter } from '@/lib/beacon/types'
import {
  buildOntologyRows,
  isTissueOrCellOntologyId,
  isTissueOrCellType,
  membershipByMatrix,
  ontologyCellKey,
  ontologyFilterIdSet,
  probeFiltersForOntology,
  seedOntologyCells,
  tissueOntologyIds,
  type OntologyGridCell,
  type OntologyRow,
} from './biosample-ontology-grid'

const liver: FilteringTerm = {
  type: 'UBERON',
  id: 'UBERON:0002107',
  label: 'liver',
  scopes: ['biosample'],
}
const brain: FilteringTerm = {
  type: 'UBERON',
  id: 'UBERON:0000955',
  label: 'brain',
  scopes: ['biosample'],
}
const status: FilteringTerm = {
  type: 'EFO',
  id: 'EFO:0009654',
  label: 'reference sample',
  scopes: ['biosample'],
}
const ageBracket: FilteringTerm = {
  type: 'alphanumeric',
  id: 'age_bracket',
  scopes: ['biosample'],
  values: ['adult'],
}

console.assert(isTissueOrCellType(liver) === true)
console.assert(isTissueOrCellType(brain) === true)
console.assert(isTissueOrCellType(status) === false)
console.assert(isTissueOrCellType(ageBracket) === false)

const termsByMatrix = new Map<string, FilteringTerm[]>([
  ['GTEx-Liver', [liver, ageBracket, status]],
  ['GEO-multi', [liver, brain, ageBracket]],
])

const membership = membershipByMatrix(termsByMatrix)
console.assert(membership.get('GTEx-Liver')?.has('UBERON:0002107') === true)
console.assert(membership.get('GTEx-Liver')?.has('UBERON:0000955') !== true)
console.assert(tissueOntologyIds([liver, brain, status]).size === 2)

const rows = buildOntologyRows(termsByMatrix)
console.assert(rows[0]?.id === 'UBERON:0000955', 'core brain first')
console.assert(rows.some((r) => r.id === 'UBERON:0002107'))
console.assert(!rows.some((r) => r.id === 'EFO:0009654'))

const restricted = buildOntologyRows(
  termsByMatrix,
  new Set(['UBERON:0002107'])
)
console.assert(restricted.length === 1 && restricted[0]?.id === 'UBERON:0002107')

const cells = new Map<string, OntologyGridCell>()
seedOntologyCells(
  cells,
  rows as OntologyRow[],
  ['GTEx-Liver', 'GEO-multi'],
  membership
)
console.assert(
  cells.get(ontologyCellKey('UBERON:0000955', 'GTEx-Liver'))?.state === 'absent'
)
console.assert(
  !cells.has(ontologyCellKey('UBERON:0002107', 'GTEx-Liver')),
  'member cells stay pending'
)
console.assert(
  !cells.has(ontologyCellKey('UBERON:0000955', 'GEO-multi')),
  'brain present in GEO stays pending'
)

const ontologyOnly: UiFilter[] = [
  { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' },
]
console.assert(isTissueOrCellOntologyId('UBERON:0002107') === true)
console.assert(isTissueOrCellOntologyId('OBI:0001876') === false)
console.assert(ontologyFilterIdSet(ontologyOnly)?.has('UBERON:0002107') === true)
console.assert(
  ontologyFilterIdSet([
    { kind: 'alphanumeric', id: 'age_bracket', value: 'adult' },
  ]) === null
)
console.assert(
  ontologyFilterIdSet([{ kind: 'ontology', id: 'OBI:0001876', label: 'cell culture' }]) ===
    null
)
console.assert(
  ontologyFilterIdSet([
    {
      kind: 'custom',
      id: 'biosample.preset:female+UBERON:0002048',
      label: 'female + lung',
    },
  ]) === null
)

const probed = probeFiltersForOntology('UBERON:0002107', 'liver', [
  { kind: 'alphanumeric', id: 'age_bracket', value: 'adult' },
])
console.assert(probed.length === 2)
console.assert(probed[0]?.kind === 'ontology' && probed[0].id === 'UBERON:0002107')
console.assert(
  probed[1]?.kind === 'alphanumeric' &&
    probed[1].id === 'age_bracket' &&
    probed[1].value === 'adult'
)

const probedSame = probeFiltersForOntology('UBERON:0002107', 'liver', ontologyOnly)
console.assert(probedSame.length === 1)

const probedWithObi = probeFiltersForOntology('UBERON:0002107', 'liver', [
  { kind: 'ontology', id: 'OBI:0001876', label: 'cell culture' },
  { kind: 'alphanumeric', id: 'age_bracket', value: 'adult' },
])
console.assert(
  probedWithObi.some((f) => f.kind === 'ontology' && f.id === 'UBERON:0002107')
)
console.assert(
  probedWithObi.some((f) => f.kind === 'ontology' && f.id === 'OBI:0001876'),
  'non-tissue ontology kept as probe constraint'
)
console.assert(
  probedWithObi.some(
    (f) => f.kind === 'alphanumeric' && f.id === 'age_bracket' && f.value === 'adult'
  )
)

const probedDropOtherTissue = probeFiltersForOntology('UBERON:0002107', 'liver', [
  { kind: 'ontology', id: 'UBERON:0000955', label: 'brain' },
])
console.assert(
  !probedDropOtherTissue.some(
    (f) => f.kind === 'ontology' && f.id === 'UBERON:0000955'
  ),
  'other tissue ontologies dropped for row probe'
)

console.log('biosample-ontology-grid.test.ts: ok')
