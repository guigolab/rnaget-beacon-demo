import {
  exploreHeatmapFeatureFilters,
  exploreLensSearchParams,
  parseExploreLensSearch,
  tissueOntologyIdsFromBiosampleFilters,
} from './explore-lens'

const params = exploreLensSearchParams({
  featureFilters: [
    { kind: 'custom', id: 'symbol:TP53', label: 'TP53' },
    {
      kind: 'custom',
      id: 'tissueHigh:UBERON:0002107',
      label: 'High in liver',
    },
  ],
  biosampleFilters: [
    { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' },
  ],
})
const parsed = parseExploreLensSearch(params)
console.assert(
  parsed.featureFilters.some(
    (f) => f.kind === 'custom' && f.id === 'symbol:TP53'
  )
)
console.assert(
  parsed.featureFilters.some(
    (f) => f.kind === 'custom' && f.id === 'tissueHigh:UBERON:0002107'
  )
)
console.assert(
  parsed.biosampleFilters.some(
    (f) => f.kind === 'ontology' && f.id === 'UBERON:0002107'
  )
)
console.assert(!params.toString().includes('tissueTop:'))
console.assert(!params.toString().includes('tissuePresent:'))

const oids = tissueOntologyIdsFromBiosampleFilters([
  { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' },
  { kind: 'ontology', id: 'UBERON:0002048', label: 'lung' },
  {
    kind: 'custom',
    id: 'biosample.preset:female+UBERON:0002048',
    label: 'female + lung',
  },
])
console.assert(oids.join(',') === 'UBERON:0002107,UBERON:0002048')

const composed = exploreHeatmapFeatureFilters(
  [{ kind: 'custom', id: 'symbol:TP53', label: 'TP53' }],
  [{ kind: 'ontology', id: 'UBERON:0002107', label: 'liver' }]
)
console.assert(composed.some((f) => f.kind === 'custom' && f.id === 'symbol:TP53'))
console.assert(
  composed.some((f) => f.kind === 'custom' && f.id === 'tissuePresent:UBERON:0002107')
)

const casedParams = exploreLensSearchParams({
  featureFilters: [
    { kind: 'custom', id: 'symbol:Alb', label: 'Alb' },
    { kind: 'custom', id: 'symbol:ALB', label: 'ALB' },
  ],
  biosampleFilters: [],
})
const casedParsed = parseExploreLensSearch(casedParams)
console.assert(casedParsed.featureFilters.length === 2)
console.assert(
  casedParsed.featureFilters.some((f) => f.kind === 'custom' && f.id === 'symbol:Alb')
)
console.assert(
  casedParsed.featureFilters.some((f) => f.kind === 'custom' && f.id === 'symbol:ALB')
)

const bioOnly = exploreHeatmapFeatureFilters(
  [],
  [{ kind: 'ontology', id: 'UBERON:0002107', label: 'liver' }]
)
console.assert(bioOnly.length === 1)
console.assert(
  bioOnly[0].kind === 'custom' && bioOnly[0].id === 'tissuePresent:UBERON:0002107'
)

console.log('explore-lens.test.ts: ok')
