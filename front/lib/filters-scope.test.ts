import {
  buildFilterScopeIndex,
  geneLensSearchParams,
  isFeatureLensFilter,
  isMatrixLensFilter,
  mergeFilterScopeIndexes,
  parseGeneLensSearch,
  parseMatrixLensSearch,
  parseSampleLensSearch,
  sampleLensSearchParams,
  scopeOf,
} from '@/lib/beacon/filters'
import type { FilteringTerm, UiFilter } from '@/lib/beacon/types'

function ontologyId(f: UiFilter): string | undefined {
  return f.kind === 'ontology' || f.kind === 'custom' ? f.id : undefined
}

const featureGo: FilteringTerm = {
  id: 'GO:0008150',
  label: 'biological_process',
  type: 'GO',
  scopes: ['genomicFeature'],
}

const biosampleGo: FilteringTerm = {
  id: 'GO:0005829',
  label: 'cytosol',
  type: 'GO',
  scopes: ['biosample'],
}

const matrixObi: FilteringTerm = {
  id: 'OBI:0003090',
  label: 'bulk RNA-seq assay',
  type: 'OBI',
  scopes: ['matrix'],
}

const biosampleObi: FilteringTerm = {
  id: 'OBI:0001876',
  label: 'cell culture',
  type: 'OBI',
  scopes: ['biosample'],
}

const merged = mergeFilterScopeIndexes(
  buildFilterScopeIndex([featureGo]),
  buildFilterScopeIndex([biosampleGo, biosampleObi]),
  buildFilterScopeIndex([matrixObi])
)

const goFeature: UiFilter = { kind: 'ontology', id: 'GO:0008150' }
const goBio: UiFilter = { kind: 'ontology', id: 'GO:0005829' }
const obiMatrix: UiFilter = { kind: 'ontology', id: 'OBI:0003090' }
const obiBio: UiFilter = { kind: 'ontology', id: 'OBI:0001876' }

console.assert(scopeOf(goFeature, merged) === 'feature')
console.assert(scopeOf(goBio, merged) === 'biosample')
console.assert(scopeOf(obiMatrix, merged) === 'matrix')
console.assert(scopeOf(obiBio, merged) === 'biosample')

const params = new URLSearchParams(
  'filters=GO:0008150,GO:0005829,OBI:0003090,EFO:0009655'
)
const featureLens = parseGeneLensSearch(params, merged)
console.assert(
  featureLens.featureFilters.some((f) => ontologyId(f) === 'GO:0008150')
)
console.assert(
  !featureLens.featureFilters.some((f) => ontologyId(f) === 'GO:0005829')
)

const sampleLens = parseSampleLensSearch(params, merged)
console.assert(
  sampleLens.biosampleFilters.some((f) => ontologyId(f) === 'GO:0005829')
)
console.assert(
  sampleLens.biosampleFilters.some((f) => ontologyId(f) === 'EFO:0009655')
)

const matrixLens = parseMatrixLensSearch(params, merged)
console.assert(
  matrixLens.matrixFilters.some((f) => ontologyId(f) === 'OBI:0003090')
)

const soFeature: FilteringTerm = {
  id: 'SO:0000704',
  label: 'gene',
  type: 'SO',
  scopes: ['genomicFeature'],
}
const mergedSo = mergeFilterScopeIndexes(
  buildFilterScopeIndex([soFeature]),
  merged
)
const soFilter: UiFilter = { kind: 'ontology', id: 'SO:0000704' }
console.assert(isMatrixLensFilter(soFilter, mergedSo) === true)

const profileSource: UiFilter = {
  kind: 'custom',
  id: 'matrix.profileSource:gtex',
  label: 'GTEx',
}
console.assert(scopeOf(profileSource) === 'matrix')
console.assert(isMatrixLensFilter(profileSource) === true)

const dualSo: FilteringTerm = {
  id: 'SO:0000704',
  label: 'gene',
  type: 'SO',
  scopes: ['genomicFeature', 'matrix'],
}
const geoSample: FilteringTerm = {
  id: 'GEO:sample',
  label: 'GEO sample',
  type: 'custom',
  scopes: ['biosample'],
}
const roundTrip = mergeFilterScopeIndexes(
  buildFilterScopeIndex([dualSo, featureGo]),
  buildFilterScopeIndex([biosampleGo, geoSample]),
  buildFilterScopeIndex([matrixObi])
)
const soBoth: UiFilter = { kind: 'ontology', id: 'SO:0000704', label: 'gene' }
console.assert(scopeOf(soBoth, roundTrip) === 'matrix')
console.assert(isFeatureLensFilter(soBoth, roundTrip) === true)

const featureWritten = geneLensSearchParams({ filters: [soBoth], index: roundTrip })
const featureRead = parseGeneLensSearch(featureWritten, roundTrip)
console.assert(featureRead.featureFilters.some((f) => ontologyId(f) === 'SO:0000704'))

const biotype: UiFilter = {
  kind: 'alphanumeric',
  id: 'feature.biotypeFamily',
  value: 'protein_coding',
  label: 'Protein-coding',
}
const resource: UiFilter = {
  kind: 'alphanumeric',
  id: 'feature.resource',
  value: 'GenCode',
  label: 'Annotation resource',
}
console.assert(isFeatureLensFilter(biotype) === true)
console.assert(isFeatureLensFilter(resource) === true)
const featureAlphaWritten = geneLensSearchParams({
  filters: [biotype, resource],
  index: roundTrip,
})
const featureAlphaRead = parseGeneLensSearch(featureAlphaWritten, roundTrip)
console.assert(
  featureAlphaRead.featureFilters.some(
    (f) => f.kind === 'alphanumeric' && f.id === 'feature.biotypeFamily' && f.value === 'protein_coding'
  )
)
console.assert(
  featureAlphaRead.featureFilters.some(
    (f) => f.kind === 'alphanumeric' && f.id === 'feature.resource' && f.value === 'GenCode'
  )
)

const sampleWritten = sampleLensSearchParams({
  filters: [
    { kind: 'ontology', id: 'GO:0005829', label: 'cytosol' },
    { kind: 'ontology', id: 'GEO:sample', label: 'GEO sample' },
  ],
  index: roundTrip,
})
const sampleRead = parseSampleLensSearch(sampleWritten, roundTrip)
console.assert(sampleRead.biosampleFilters.some((f) => ontologyId(f) === 'GO:0005829'))
console.assert(sampleRead.biosampleFilters.some((f) => ontologyId(f) === 'GEO:sample'))
console.assert(!sampleWritten.get('filters')?.includes('GO:0008150'))

console.log('filters-scope.test.ts: ok')
