import { isCustomId } from '@/lib/beacon/filters'
import type { FilteringResource, FilteringTerm, UiFilter } from '@/lib/beacon/types'

const LOOKUP_PREFIXES = ['HGNC', 'NCBIGene', 'ENSEMBL'] as const

const LOOKUP_EXAMPLES: Record<string, string> = {
  HGNC: 'HGNC:11998',
  NCBIGene: 'NCBIGene:7157',
  ENSEMBL: 'ENSEMBL:ENSG00000141510',
}

export function lookupExample(prefix: string): string {
  return LOOKUP_EXAMPLES[prefix] ?? `${prefix}:…`
}

const FEATURE_PREFIXES = ['HGNC', 'NCBIGene', 'ENSEMBL', 'SO', 'GO'] as const
const BIOSAMPLE_PREFIXES = ['UBERON', 'EFO', 'MONDO', 'HP', 'NCIT', 'OBI', 'GO'] as const
const MATRIX_PREFIXES = ['OBI', 'SO'] as const

export function isHiddenFilteringTerm(term: FilteringTerm): boolean {
  const id = term.id.trim().toLowerCase()
  if (!id) return true
  if (id.startsWith('resource:')) return true
  if (id === 'genomicfeature.symbol') return true
  return false
}

export function termToUiFilter(term: FilteringTerm): UiFilter {
  if (term.type === 'custom' || isCustomId(term.id)) {
    return { kind: 'custom', id: term.id, label: term.label }
  }
  return { kind: 'ontology', id: term.id, label: term.label }
}

export function browsableTerms(terms: FilteringTerm[]): FilteringTerm[] {
  return terms.filter((term) => !isHiddenFilteringTerm(term))
}

function presentPrefixes(
  terms: FilteringTerm[],
  resources: FilteringResource[]
): Set<string> {
  const present = new Set<string>()
  for (const term of terms) {
    if (isHiddenFilteringTerm(term)) continue
    if (!term.type || term.type === 'alphanumeric' || term.type === 'custom') continue
    present.add(term.type)
  }
  for (const resource of resources) {
    const prefix = resource.nameSpacePrefix
    if (prefix && (LOOKUP_PREFIXES as readonly string[]).includes(prefix)) {
      present.add(prefix)
    }
  }
  return present
}

/** Placeholder built only from prefixes that exist in this catalog. */
export function lensQueryPlaceholder(
  kind: 'feature' | 'biosample' | 'matrix',
  terms: FilteringTerm[],
  resources: FilteringResource[] = []
): string {
  if (!terms.length && !resources.length) return 'Add filter…'
  const present = presentPrefixes(terms, resources)
  if (kind === 'feature') {
    const parts = ['Symbol']
    for (const prefix of FEATURE_PREFIXES) {
      if (present.has(prefix)) parts.push(`${prefix}:…`)
    }
    return parts.join(', ')
  }
  if (kind === 'biosample') {
    const parts: string[] = []
    for (const prefix of BIOSAMPLE_PREFIXES) {
      if (present.has(prefix)) parts.push(`${prefix}:…`)
    }
    const sex = terms.find((term) => term.id === 'sex')
    const sexValue = sex?.values?.[0]
    if (sexValue) parts.push(sexValue)
    const condition = terms.find((term) => term.id === 'condition')
    if (condition?.values?.length) parts.push('condition')
    return parts.length ? parts.join(', ') : 'Tissue, sex, condition'
  }
  const parts: string[] = []
  const unit = terms.find((term) => term.id === 'matrix.unit')
  if (unit?.values?.[0]) parts.push(unit.values[0])
  for (const prefix of MATRIX_PREFIXES) {
    if (present.has(prefix)) parts.push(`${prefix}:…`)
  }
  return parts.length ? parts.join(', ') : 'Unit, assay, feature type'
}

export function isLookupPrefix(prefix: string | undefined): boolean {
  if (!prefix) return false
  return (LOOKUP_PREFIXES as readonly string[]).includes(prefix)
}
