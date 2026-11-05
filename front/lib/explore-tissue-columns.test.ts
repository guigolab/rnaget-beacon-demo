import type { FilteringTerm, UiFilter } from '@/lib/beacon'
import {
  columnsWithProbedCounts,
  partitionExploreBiosampleFilters,
  probeFiltersForTissueColumn,
  resolveExploreTissueColumns,
} from '@/lib/explore-tissue-columns'
import type { TissueColumn } from '@/lib/tissue-levels'

const liver: FilteringTerm = {
  type: 'UBERON',
  id: 'UBERON:0002107',
  label: 'liver',
  scopes: ['biosample'],
}
const lung: FilteringTerm = {
  type: 'UBERON',
  id: 'UBERON:0002048',
  label: 'lung',
  scopes: ['biosample'],
}
const blood: FilteringTerm = {
  type: 'UBERON',
  id: 'UBERON:0000178',
  label: 'blood',
  scopes: ['biosample'],
}
/** Legacy tissueHigh still merges if present. */
const matrixPseudo: FilteringTerm = {
  type: 'custom',
  id: 'tissueHigh:matrix:M1',
  label: 'High in Unannotated (M1) (n=3)',
  scopes: ['genomicFeature'],
}

const parted = partitionExploreBiosampleFilters([
  { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' },
  {
    kind: 'custom',
    id: 'biosample.preset:female+UBERON:0002048',
    label: 'female + lung',
  },
  { kind: 'alphanumeric', id: 'age_bracket', value: 'adult' },
  { kind: 'ontology', id: 'OBI:0001876', label: 'cell culture' },
])
console.assert(parted.tissueFilters.length === 1)
console.assert(parted.constraintFilters.length === 3)
console.assert(
  parted.constraintFilters.some(
    (f) => f.kind === 'alphanumeric' && f.id === 'age_bracket' && f.value === 'adult'
  )
)
console.assert(
  parted.constraintFilters.some(
    (f) => f.kind === 'ontology' && f.id === 'OBI:0001876'
  ),
  'non-tissue ontology is a constraint (Option A probe)'
)
console.assert(
  parted.constraintFilters.some(
    (f) => f.kind === 'custom' && f.id.startsWith('biosample.preset:')
  )
)

const emptyPart = partitionExploreBiosampleFilters([])
console.assert(emptyPart.tissueFilters.length === 0)
console.assert(emptyPart.constraintFilters.length === 0)

const liverCol: TissueColumn = {
  ontologyId: 'UBERON:0002107',
  label: 'liver',
  nBiosamples: 100,
}
const pseudoCol: TissueColumn = {
  ontologyId: 'matrix:M1',
  label: 'Unannotated (M1)',
  nBiosamples: 3,
}
const obiConstraint: UiFilter[] = [
  { kind: 'ontology', id: 'OBI:0001876', label: 'cell culture' },
]

const liverProbes = probeFiltersForTissueColumn(liverCol, obiConstraint)
console.assert(liverProbes.length === 2)
console.assert(
  liverProbes[0]?.kind === 'ontology' && liverProbes[0].id === 'UBERON:0002107'
)
console.assert(
  liverProbes[1]?.kind === 'ontology' && liverProbes[1].id === 'OBI:0001876'
)

const pseudoProbes = probeFiltersForTissueColumn(pseudoCol, obiConstraint)
console.assert(pseudoProbes.length === 1)
console.assert(pseudoProbes[0]?.kind === 'ontology' && pseudoProbes[0].id === 'OBI:0001876')

const kept = columnsWithProbedCounts(
  [liverCol, { ...liverCol, ontologyId: 'UBERON:0002048', label: 'lung' }],
  new Map([
    ['UBERON:0002107', 12],
    ['UBERON:0002048', 0],
  ])
)
console.assert(kept.length === 1)
console.assert(kept[0]?.ontologyId === 'UBERON:0002107')
console.assert(kept[0]?.nBiosamples === 12)

async function runAsync() {
  const syncOnly = await resolveExploreTissueColumns({
    terms: [liver, lung, blood],
    biosampleFilters: [
      { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' },
    ],
  })
  console.assert(syncOnly.length === 1)
  console.assert(syncOnly[0]?.ontologyId === 'UBERON:0002107')
  console.assert(syncOnly[0]?.label === 'liver')

  const bloodOnly = await resolveExploreTissueColumns({
    terms: [liver, lung, blood],
    biosampleFilters: [
      { kind: 'ontology', id: 'UBERON:0000178', label: 'blood' },
    ],
  })
  console.assert(bloodOnly.length === 1)
  console.assert(bloodOnly[0]?.ontologyId === 'UBERON:0000178')

  const bloodNoHigh = await resolveExploreTissueColumns({
    terms: [],
    biosampleFilters: [
      { kind: 'ontology', id: 'UBERON:0000178', label: 'blood' },
    ],
  })
  console.assert(bloodNoHigh.length === 1, 'synthesize blood without catalog')

  const probed = await resolveExploreTissueColumns({
    terms: [liver, lung, matrixPseudo],
    biosampleFilters: obiConstraint,
    listMatrixIds: async () => ['M_A', 'M_B'],
    ontologyMatrixIndex: new Map([
      ['uberon:0002107', ['M_A']],
      ['uberon:0002048', ['M_B']],
    ]),
    probeColumnCount: async (column, _constraints, matrixIds) => {
      // Narrowed probes should only see matrices for that tissue.
      if (column.ontologyId === 'UBERON:0002107') {
        console.assert(
          matrixIds.length === 1 && matrixIds[0] === 'M_A',
          `liver matrices: ${matrixIds.join(',')}`
        )
        return 7
      }
      if (column.ontologyId === 'matrix:M1') return 2
      return 0
    },
  })
  console.assert(probed.length === 2)
  console.assert(
    probed.some((c) => c.ontologyId === 'UBERON:0002107' && c.nBiosamples === 7)
  )
  console.assert(
    probed.some((c) => c.ontologyId === 'matrix:M1' && c.nBiosamples === 2)
  )
  console.assert(!probed.some((c) => c.ontologyId === 'UBERON:0002048'))

  const absentIndex = await resolveExploreTissueColumns({
    terms: [liver, lung],
    biosampleFilters: obiConstraint,
    ontologyMatrixIndex: new Map(),
    listMatrixIds: async () => ['M_A'],
    probeColumnCount: async () => 9,
  })
  console.assert(
    absentIndex.length === 0,
    'empty ontology index skips all tissue columns'
  )

  console.log('explore-tissue-columns.test.ts: ok')
}

runAsync().catch((err) => {
  console.error(err)
  process.exit(1)
})
