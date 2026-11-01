import assert from 'node:assert/strict'
import {
  featureIdListCsv,
  interpretBiosampleQueryToken,
  interpretFeatureQueryToken,
  matrixWorkspaceHasConstraints,
  matrixWorkspaceQueryKey,
  matrixWorkspaceSearchParams,
  parseMatrixWorkspaceQuery,
} from '@/lib/matrix-workspace-query'
import type { FilteringTerm } from '@/lib/beacon/types'

const params = new URLSearchParams(
  'symbol=TP53&genes=tp53,BRCA1&featureIds=ENSG00000141510&recordKind=biosample&recordId=sample-1&matrix.unit=TPM&minValue=1'
)
const query = parseMatrixWorkspaceQuery(params)

assert.deepEqual(query.genes, ['TP53', 'BRCA1'])
assert.deepEqual(query.featureIds, ['ENSG00000141510'])
assert.equal(query.minValue, 1)
assert.equal(query.featureFilters.length, 0)
assert.equal(query.biosampleFilters.length, 0)

const withRecord = matrixWorkspaceQueryKey(query)
const withoutRecord = matrixWorkspaceQueryKey(
  parseMatrixWorkspaceQuery(new URLSearchParams('symbol=TP53&genes=BRCA1&featureIds=ENSG00000141510&minValue=1'))
)
assert.equal(withRecord, withoutRecord)

const written = matrixWorkspaceSearchParams(query, params)
assert.equal(written.get('symbol'), 'TP53,BRCA1')
assert.equal(written.get('genes'), null)
assert.equal(written.get('matrix.unit'), null)
assert.equal(written.get('recordKind'), 'biosample')
assert.equal(written.get('recordId'), 'sample-1')
assert.equal(written.get('featureIds'), 'ENSG00000141510')
assert.equal(matrixWorkspaceHasConstraints(query), true)

const featureToken = interpretFeatureQueryToken('UBERON:0002107', [], undefined)
assert.equal(featureToken.ok, false)
if (!featureToken.ok) assert.match(featureToken.message, /biosample/)

const accession = interpretFeatureQueryToken('ENSG00000141510.18', [], undefined)
assert.equal(accession.ok, true)
if (accession.ok) assert.equal(accession.kind, 'featureId')

const terms: FilteringTerm[] = [
  { id: 'sex', type: 'alphanumeric', scopes: ['biosample'], values: ['female', 'male'] },
  { id: 'UBERON:0002107', type: 'UBERON', label: 'liver', scopes: ['biosample'] },
]
const sex = interpretBiosampleQueryToken('female', terms, undefined)
assert.equal(sex.ok, true)
if (sex.ok) assert.equal(sex.kind, 'filter')
const tissue = interpretBiosampleQueryToken('liver', terms, undefined)
assert.equal(tissue.ok, true)
if (tissue.ok && tissue.kind === 'filter' && tissue.filter.kind === 'ontology') {
  assert.equal(tissue.filter.id, 'UBERON:0002107')
}
const wrong = interpretBiosampleQueryToken('SO:0000704', terms, undefined)
assert.equal(wrong.ok, false)

assert.equal(featureIdListCsv({ genes: ['TP53'], featureIds: ['ENSG00000141510'] }), 'TP53,ENSG00000141510')

console.log('matrix-workspace-query.test.ts ok')
