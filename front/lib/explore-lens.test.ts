import {
  EXPLORE_LENS_PAGE_SIZE,
  exploreHeatmapFeatureFilters,
  exploreHeatmapTopFirstFilters,
  exploreLensSearchParams,
  isExploreTissueTopFirstSeed,
  parseExploreLensSearch,
  tissueOntologyIdsFromBiosampleFilters,
} from './explore-lens'
import { symbolFilter, tissuePercentileFilter } from './beacon/filters'
import type { UiFilter } from './beacon/types'

const liver: UiFilter = { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' }

const params = exploreLensSearchParams({
  featureFilters: [symbolFilter('TP53'), tissuePercentileFilter('UBERON:0002107', '99')],
  biosampleFilters: [liver],
})
const parsed = parseExploreLensSearch(params)
console.assert(parsed.featureFilters.some((f) => f.kind === 'symbol' && f.value === 'TP53'))
console.assert(
  parsed.featureFilters.some(
    (f) =>
      f.kind === 'expression' &&
      f.id === 'tissue.percentile:UBERON:0002107' &&
      f.operator === '>=' &&
      f.value === '99'
  ),
  'tissue percentile survives the URL round trip as an alphanumeric term'
)
console.assert(
  parsed.biosampleFilters.some((f) => f.kind === 'ontology' && f.id === 'UBERON:0002107')
)
console.assert(!params.toString().includes('tissueTop'))
console.assert(!params.toString().includes('tissuePresent'))

// Legacy compact ids in old URLs are rewritten as alphanumeric filters.
const legacy = parseExploreLensSearch(
  new URLSearchParams(
    'filters=symbol:TP53,tissueTop:UBERON:0002107,matrix.profileSource:gtex'
  )
)
console.assert(legacy.featureFilters.some((f) => f.kind === 'symbol' && f.value === 'TP53'))
console.assert(
  legacy.featureFilters.some(
    (f) => f.kind === 'expression' && f.id === 'tissue.percentile:UBERON:0002107'
  )
)

const oids = tissueOntologyIdsFromBiosampleFilters([
  liver,
  { kind: 'ontology', id: 'UBERON:0002048', label: 'lung' },
  { kind: 'alphanumeric', id: 'age_bracket', value: 'adult' },
])
console.assert(oids.join(',') === 'UBERON:0002107,UBERON:0002048')

const composed = exploreHeatmapFeatureFilters([symbolFilter('TP53')], [liver])
console.assert(composed.some((f) => f.kind === 'symbol' && f.value === 'TP53'))
console.assert(
  composed.some(
    (f) =>
      f.kind === 'expression' &&
      f.id === 'tissue.percentile:UBERON:0002107' &&
      f.value === '0'
  )
)

const casedParams = exploreLensSearchParams({
  featureFilters: [symbolFilter('Alb'), symbolFilter('ALB')],
  biosampleFilters: [],
})
const casedParsed = parseExploreLensSearch(casedParams)
console.assert(casedParsed.featureFilters.length === 2)
console.assert(casedParsed.featureFilters.some((f) => f.kind === 'symbol' && f.value === 'Alb'))
console.assert(casedParsed.featureFilters.some((f) => f.kind === 'symbol' && f.value === 'ALB'))

const bioOnly = exploreHeatmapFeatureFilters([], [liver])
console.assert(bioOnly.length === 1)
console.assert(
  bioOnly[0].kind === 'expression' &&
    bioOnly[0].id === 'tissue.percentile:UBERON:0002107' &&
    bioOnly[0].value === '0'
)

console.assert(EXPLORE_LENS_PAGE_SIZE === 5)
console.assert(isExploreTissueTopFirstSeed([], [liver]))
console.assert(!isExploreTissueTopFirstSeed([symbolFilter('TP53')], [liver]))
const topFirst = exploreHeatmapTopFirstFilters([], [liver])
console.assert(
  topFirst.length === 1 &&
    topFirst[0].kind === 'expression' &&
    topFirst[0].id === 'tissue.percentile:UBERON:0002107' &&
    topFirst[0].value === '99'
)

console.log('explore-lens.test.ts: ok')
