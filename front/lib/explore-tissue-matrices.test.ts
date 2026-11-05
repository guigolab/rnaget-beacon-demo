import type { Feature, FilteringTerm } from '@/lib/beacon/types'
import {
  buildOntologyMatrixIndex,
  featureMatrixIdsForTissue,
  matrixIdsForOntology,
} from '@/lib/explore-tissue-matrices'

function tissueTerm(id: string, label: string): FilteringTerm {
  const type = id.split(':', 1)[0]?.toUpperCase()
  return {
    id,
    label,
    type,
    scopes: ['biosample'],
  }
}

const termsByMatrix = new Map<string, FilteringTerm[]>([
  [
    'M1',
    [
      tissueTerm('UBERON:0002107', 'liver'),
      tissueTerm('UBERON:0000178', 'blood'),
      { id: 'EFO:0009654', label: 'reference', type: 'EFO', scopes: ['biosample'] },
    ],
  ],
  ['M2', [tissueTerm('UBERON:0002107', 'liver')]],
  ['M3', [{ id: 'sex', label: 'Sex', type: 'alphanumeric', scopes: ['biosample'] }]],
])

const index = buildOntologyMatrixIndex(termsByMatrix)

const liverMatrices = matrixIdsForOntology(index, 'UBERON:0002107')
console.assert(
  liverMatrices.join(',') === 'M1,M2',
  `liver matrices: ${liverMatrices.join(',')}`
)
console.assert(
  matrixIdsForOntology(index, 'uberon:0002107').join(',') === 'M1,M2',
  'ontology lookup is case-insensitive'
)
console.assert(matrixIdsForOntology(index, 'UBERON:0000178').join(',') === 'M1')
console.assert(
  matrixIdsForOntology(index, 'EFO:0009654').length === 0,
  'sample status is not a tissue column'
)
console.assert(matrixIdsForOntology(index, 'UBERON:9999999').length === 0)

const feature: Feature = {
  id: 'g1',
  matrixIds: ['M2', 'M3', 'M1'],
}
const cellMatrices = featureMatrixIdsForTissue(feature, liverMatrices)
console.assert(
  cellMatrices.join(',') === 'M1,M2',
  `feature ∩ tissue: ${cellMatrices.join(',')}`
)
console.assert(
  featureMatrixIdsForTissue({ id: 'g2', matrixIds: ['M3'] }, liverMatrices)
    .length === 0,
  'no overlap yields empty'
)
console.assert(
  featureMatrixIdsForTissue({ id: 'g3' }, liverMatrices).length === 0,
  'missing matrixIds yields empty'
)

/** Count probes must target only catalog matrices for the ontology. */
function countProbeTargets(
  ontologyId: string,
  catalog: Map<string, string[]>
): string[] {
  return matrixIdsForOntology(catalog, ontologyId)
}
console.assert(
  countProbeTargets('UBERON:0002107', index).join(',') === 'M1,M2'
)
console.assert(countProbeTargets('UBERON:0000178', index).join(',') === 'M1')

console.log('explore-tissue-matrices.test.ts: ok')
