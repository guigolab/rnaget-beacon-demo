import { parseGeneLensSearch, tokenToFilter } from '@/lib/beacon/filters'

console.assert(tokenToFilter('HGNC:1100', 'feature')?.kind === 'ontology')
console.assert(tokenToFilter('SO:0000704', 'feature')?.kind === 'ontology')
const bare = tokenToFilter('TP53', 'feature')
console.assert(bare?.kind === 'custom' && bare.id === 'symbol:TP53')
console.assert(tokenToFilter('symbol:ALB', 'feature')?.kind === 'custom')

const empty = parseGeneLensSearch(new URLSearchParams())
console.assert(empty.featureFilters.length === 0)

const ontology = parseGeneLensSearch(new URLSearchParams('filters=SO:0000704'))
console.assert(ontology.featureFilters[0]?.kind === 'ontology')

console.log('filters-gene.test.ts: ok')
