import assert from 'node:assert/strict'
import {
  matrixHeatmapBiosampleExamples,
  matrixHeatmapFeatureExamples} from '@/lib/matrix-workspace'
import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'

function ontologyId(filter: UiFilter): string | undefined {
  return filter.kind === 'ontology' ? filter.id : undefined
}

function allExamples(
  set: ReturnType<typeof matrixHeatmapFeatureExamples>
) {
  return [...set.pinned, ...set.more]
}

const gtexFeatureTerms: FilteringTerm[] = [
  { id: 'SO:0000704', type: 'SO', label: 'gene', scopes: ['genomicFeature', 'matrix'] },
  { id: 'SO:0001217', type: 'SO', label: 'protein_coding_gene', scopes: ['genomicFeature'] },
  {
    id: 'feature.biotypeFamily',
    type: 'custom',
    label: 'Gene type',
    scopes: ['genomicFeature'],
    values: ['protein_coding', 'lncRNA']},
  {
    id: 'expression.percentile',
    type: 'custom',
    scopes: ['genomicFeature'],
    values: ['90', '95', '99']},
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
    aliases: ['ENSG00000198886', 'MT-ND4'],
      featureIdentifier: { id: 'ENSG00000198886.2' }},
  {
    id: 'feature-ENSG00000198938.2',
    aliases: ['ENSG00000198938', 'MT-CO3'],
      featureIdentifier: { id: 'ENSG00000198938.2' }},
  {
    id: 'feature-ENSG00000198763.3',
    aliases: ['ENSG00000198763', 'MT-ND2'],
      featureIdentifier: { id: 'ENSG00000198763.3' }},
  {
    id: 'feature-ENSG00000198804.2',
    aliases: ['ENSG00000198804', 'MT-CO1'],
      featureIdentifier: { id: 'ENSG00000198804.2' }},
]

const gtexFeatures = matrixHeatmapFeatureExamples(gtexFeatureTerms, preview)
assert.ok(gtexFeatures.pinned.length <= 3)
assert.ok(gtexFeatures.more.length >= 1)
const gtexAll = allExamples(gtexFeatures)
assert.deepEqual(
  gtexAll
    .filter(
      (example) =>
        example.filter.kind === 'custom' &&
        example.filter.id.toLowerCase().startsWith('symbol:')
    )
    .map((example) => example.label),
  ['MT-ND4', 'MT-CO3', 'MT-ND2', 'MT-CO1']
)
assert.ok(
  gtexAll.some(
    (example) =>
      example.filter.kind === 'alphanumeric' &&
      example.filter.id === 'feature.biotypeFamily' &&
      example.filter.value === 'protein_coding'
  )
)
assert.ok(
  gtexAll.some(
    (example) =>
      example.filter.kind === 'expression' &&
      example.filter.id === 'expression.percentile' &&
      example.filter.value === '99'
  )
)
assert.ok(!gtexAll.some((example) => ontologyId(example.filter) === 'SO:0000704'))
assert.ok(!gtexAll.some((example) => example.label === 'TP53' || example.label === 'ALB'))
assert.deepEqual(
  gtexFeatures.pinned.map((e) => e.label).slice(0, 2),
  ['MT-ND4', 'MT-CO3']
)

const noGenes = matrixHeatmapFeatureExamples(gtexFeatureTerms, [])
assert.ok(noGenes.pinned.length <= 3)
assert.ok(
  allExamples(noGenes).every(
    (example) =>
      example.filter.kind === 'alphanumeric' || example.filter.kind === 'expression'
  )
)
assert.ok(!allExamples(noGenes).some((example) => example.label === 'TP53'))

const gtexBiosamples = matrixHeatmapBiosampleExamples(gtexBiosampleTerms)
assert.ok(gtexBiosamples.pinned.length <= 3)
assert.deepEqual(
  gtexBiosamples.pinned.map((example) => ontologyId(example.filter) ?? example.label),
  ['UBERON:0002107']
)
assert.ok(!allExamples(gtexBiosamples).some((example) => ontologyId(example.filter) === 'NCIT:C63637'))
assert.ok(
  !allExamples(gtexBiosamples).some(
    (example) =>
      example.filter.kind === 'alphanumeric' && example.filter.id === 'condition'
  )
)
assert.ok(
  !allExamples(gtexBiosamples).some(
    (example) => example.label === 'female reproductive system'
  )
)

const geoTerms: FilteringTerm[] = [
  { id: 'sex', type: 'alphanumeric', label: 'Sex', scopes: ['biosample'], values: ['female', 'male'] },
  {
    id: 'condition',
    type: 'alphanumeric',
    label: 'Condition',
    scopes: ['biosample'],
    values: ['Healthy', 'ICU']},
  { id: 'MONDO:0100096', type: 'MONDO', label: 'COVID-19', scopes: ['biosample'] },
  {
    id: 'EFO:0004167',
    type: 'EFO',
    label: 'peripheral blood mononuclear cell',
    scopes: ['biosample']},
  { id: 'UBERON:0000178', type: 'UBERON', label: 'blood', scopes: ['biosample'] },
  { id: 'EFO:0009655', type: 'EFO', label: 'abnormal sample', scopes: ['biosample'] },
]
const geo = matrixHeatmapBiosampleExamples(geoTerms)
assert.ok(geo.pinned.length <= 3)
assert.ok(geo.pinned.length + geo.more.length >= 2)
const geoAll = allExamples(geo)
assert.ok(
  geoAll.some(
    (example) =>
      example.filter.kind === 'ontology' && example.filter.id === 'UBERON:0000178'
  )
)
assert.ok(
  !geoAll.some(
    (example) =>
      example.filter.kind === 'alphanumeric' &&
      example.filter.id === 'condition'
  )
)
const geoOntology = geoAll.filter((example) => example.filter.kind === 'ontology')
assert.ok(geoOntology.length > 0)
assert.ok(
  geoOntology.every((example) =>
    ['UBERON:0000178', 'EFO:0004167'].includes(ontologyId(example.filter) ?? '')
  )
)
assert.ok(!geoAll.some((example) => ontologyId(example.filter) === 'MONDO:0100096'))
assert.ok(
  !geoAll.some(
    (example) => example.label === 'liver' && ontologyId(example.filter) === 'UBERON:0002107'
  )
)

const encodeTerms: FilteringTerm[] = [
  { id: 'sex', type: 'alphanumeric', label: 'Sex', scopes: ['biosample'], values: ['female'] },
  { id: 'EFO:0002784', type: 'EFO', label: 'GM12878', scopes: ['biosample'] },
  { id: 'EFO:0009654', type: 'EFO', label: 'reference sample', scopes: ['biosample'] },
  { id: 'OBI:0001876', type: 'OBI', label: 'cell culture', scopes: ['biosample'] },
]
const encode = matrixHeatmapBiosampleExamples(encodeTerms)
const encodeAll = allExamples(encode)
assert.ok(encodeAll.some((example) => ontologyId(example.filter) === 'EFO:0002784'))
assert.ok(
  !encodeAll.some(
    (example) =>
      example.filter.kind === 'alphanumeric' && example.filter.id === 'condition'
  )
)
assert.ok(!encodeAll.some((example) => ontologyId(example.filter) === 'EFO:0009654'))
assert.ok(!encodeAll.some((example) => example.filter.kind === 'alphanumeric'))
assert.ok(!encodeAll.some((example) => ontologyId(example.filter) === 'UBERON:0002107'))

console.log('matrix-workspace-examples.test.ts ok')
