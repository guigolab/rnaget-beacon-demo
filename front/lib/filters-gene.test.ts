import {
  dedupeFilters,
  filterKey,
  parseGeneLensSearch,
  symbolFilter,
  tokenToFilter,
} from '@/lib/beacon/filters'

console.assert(tokenToFilter('HGNC:1100', 'feature')?.kind === 'ontology')
console.assert(tokenToFilter('SO:0000704', 'feature')?.kind === 'ontology')
const bare = tokenToFilter('TP53', 'feature')
console.assert(bare?.kind === 'symbol' && bare.value === 'TP53')
console.assert(tokenToFilter('symbol:ALB', 'feature')?.kind === 'symbol')

const alb = tokenToFilter('Alb', 'feature')
const ALB = tokenToFilter('ALB', 'feature')
console.assert(alb?.kind === 'symbol' && alb.value === 'Alb')
console.assert(ALB?.kind === 'symbol' && ALB.value === 'ALB')
console.assert(filterKey(alb!) !== filterKey(ALB!))
const both = dedupeFilters([symbolFilter('Alb'), symbolFilter('ALB')])
console.assert(both.length === 2)

const empty = parseGeneLensSearch(new URLSearchParams())
console.assert(empty.featureFilters.length === 0)

const ontology = parseGeneLensSearch(new URLSearchParams('filters=SO:0000704'))
console.assert(ontology.featureFilters[0]?.kind === 'ontology')

const cased = parseGeneLensSearch(new URLSearchParams('filters=symbol:Alb,symbol:ALB'))
console.assert(cased.featureFilters.length === 2)
console.assert(cased.featureFilters.some((f) => f.kind === 'symbol' && f.value === 'Alb'))
console.assert(cased.featureFilters.some((f) => f.kind === 'symbol' && f.value === 'ALB'))

console.log('filters-gene.test.ts: ok')
