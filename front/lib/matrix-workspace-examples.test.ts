import assert from 'node:assert/strict'
import {
  matrixHeatmapBiosampleExamples,
  matrixHeatmapFeatureExamples,
} from '@/lib/matrix-workspace'
import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'

function ontologyId(filter: UiFilter): string | undefined {
  return filter.kind === 'ontology' ? filter.id : undefined
}

const gtexFeatureTerms: FilteringTerm[] = [
  { id: 'SO:0000704', type: 'SO', label: 'gene', scopes: ['genomicFeature', 'matrix'] },
  { id: 'SO:0001217', type: 'SO', label: 'protein_coding_gene', scopes: ['genomicFeature'] },
  { id: 'SO:0002127', type: 'SO', label: 'lncRNA_gene', scopes: ['genomicFeature'] },
  { id: 'SO:0000336', type: 'SO', label: 'pseudogene', scopes: ['genomicFeature'] },
]

const gtexBiosampleTerms: FilteringTerm[] = [
  { id: 'UBERON:0002107', type: 'UBERON', label: 'liver', scopes: ['biosample'] },
  { id: 'EFO:0009654', type: 'EFO', label: 'reference sample', scopes: ['biosample'] },
  { id: 'NCIT:C63637', type: 'NCIT', scopes: ['biosample'] },
  { id: 'OBI:0001479', type: 'OBI', label: 'specimen from organism', scopes: ['biosample'] },
]

const preview: Feature[] = [
  {
    id: 'feature-ENSG00000198886.2',
    genomicFeature: {
      aliases: ['ENSG00000198886', 'MT-ND4'],
      featureIdentifier: { id: 'ENSG00000198886.2' },
    },
  },
  {
    id: 'feature-ENSG00000198938.2',
    genomicFeature: {
      aliases: ['ENSG00000198938', 'MT-CO3'],
      featureIdentifier: { id: 'ENSG00000198938.2' },
    },
  },
]

const gtexFeatures = matrixHeatmapFeatureExamples(gtexFeatureTerms, preview)
assert.deepEqual(
  gtexFeatures.filter((example) => example.filter.kind === 'symbol').map((example) => example.label),
  ['MT-ND4', 'MT-CO3']
)
assert.ok(!gtexFeatures.some((example) => ontologyId(example.filter) === 'SO:0000704'))
const firstBiotypes = gtexFeatures.filter((example) => example.filter.kind === 'ontology')
assert.equal(ontologyId(firstBiotypes[0].filter), 'SO:0001217')
assert.ok(gtexFeatures.some((example) => ontologyId(example.filter) === 'SO:0002127'))
assert.ok(!gtexFeatures.some((example) => example.label === 'TP53' || example.label === 'ALB'))

const noGenes = matrixHeatmapFeatureExamples(gtexFeatureTerms, [])
assert.ok(noGenes.every((example) => example.filter.kind === 'ontology'))
assert.ok(!noGenes.some((example) => example.label === 'TP53'))

const gtexBiosamples = matrixHeatmapBiosampleExamples(gtexBiosampleTerms)
assert.deepEqual(gtexBiosamples.map((example) => ontologyId(example.filter) ?? example.label), ['UBERON:0002107'])
assert.ok(!gtexBiosamples.some((example) => ontologyId(example.filter) === 'NCIT:C63637'))
assert.ok(!gtexBiosamples.some((example) => example.filter.kind === 'sex'))
assert.ok(!gtexBiosamples.some((example) => example.label === 'female reproductive system'))

const geoTerms: FilteringTerm[] = [
  { id: 'sex', type: 'alphanumeric', label: 'Sex', scopes: ['biosample'], values: ['female', 'male'] },
  {
    id: 'condition',
    type: 'alphanumeric',
    label: 'Condition',
    scopes: ['biosample'],
    values: ['Healthy', 'ICU'],
  },
  { id: 'MONDO:0100096', type: 'MONDO', label: 'COVID-19', scopes: ['biosample'] },
  {
    id: 'EFO:0004167',
    type: 'EFO',
    label: 'peripheral blood mononuclear cell',
    scopes: ['biosample'],
  },
  { id: 'UBERON:0000178', type: 'UBERON', label: 'blood', scopes: ['biosample'] },
  { id: 'EFO:0009655', type: 'EFO', label: 'abnormal sample', scopes: ['biosample'] },
]
const geo = matrixHeatmapBiosampleExamples(geoTerms)
assert.ok(geo.some((example) => example.filter.kind === 'sex' && example.filter.value === 'female'))
assert.ok(
  geo.some(
    (example) =>
      example.filter.kind === 'alphanumeric' &&
      example.filter.id === 'condition' &&
      example.filter.value === 'Healthy'
  )
)
const geoOntology = geo.filter((example) => example.filter.kind === 'ontology')
assert.ok(geoOntology.length > 0 && geoOntology.length <= 2)
assert.ok(
  geoOntology.every((example) =>
    ['UBERON:0000178', 'EFO:0004167'].includes(ontologyId(example.filter) ?? '')
  )
)
assert.ok(!geo.some((example) => ontologyId(example.filter) === 'MONDO:0100096'))
assert.ok(!geo.some((example) => example.label === 'liver' && ontologyId(example.filter) === 'UBERON:0002107'))

const encodeTerms: FilteringTerm[] = [
  { id: 'sex', type: 'alphanumeric', label: 'Sex', scopes: ['biosample'], values: ['female'] },
  { id: 'EFO:0002784', type: 'EFO', label: 'GM12878', scopes: ['biosample'] },
  { id: 'EFO:0009654', type: 'EFO', label: 'reference sample', scopes: ['biosample'] },
  { id: 'OBI:0001876', type: 'OBI', label: 'cell culture', scopes: ['biosample'] },
]
const encode = matrixHeatmapBiosampleExamples(encodeTerms)
assert.ok(encode.some((example) => example.filter.kind === 'sex' && example.filter.value === 'female'))
assert.ok(encode.some((example) => ontologyId(example.filter) === 'EFO:0002784'))
assert.ok(!encode.some((example) => ontologyId(example.filter) === 'EFO:0009654'))
assert.ok(!encode.some((example) => example.filter.kind === 'alphanumeric'))
assert.ok(!encode.some((example) => ontologyId(example.filter) === 'UBERON:0002107'))

console.log('matrix-workspace-examples.test.ts ok')
