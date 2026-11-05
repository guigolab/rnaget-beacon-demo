import type { CSSProperties } from 'react'
import type { FilteringTerm } from '@/lib/beacon/types'
import type { BeaconScope, NamespaceScopeGroup } from '@/lib/scope-theme'

/** Catalog filtering-term wire types used for Explore chip coloring. */
export type FilterTermType = 'ontology' | 'alphanumeric' | 'custom'

export const FILTER_TYPE_LEGEND: Array<{
  type: FilterTermType
  label: string
}> = [
  { type: 'ontology', label: 'Ontology' },
  { type: 'alphanumeric', label: 'Alphanumeric' },
  { type: 'custom', label: 'Custom' },
]

export function filterTypeCssVars(type: FilterTermType): {
  bg: string
  border: string
  text: string
  dot: string
} {
  return {
    bg: `var(--filter-${type}-bg)`,
    border: `var(--filter-${type}-border)`,
    text: `var(--filter-${type}-text)`,
    dot: `var(--filter-${type}-dot)`,
  }
}

export function filterTypeChipStyle(type: FilterTermType): CSSProperties {
  const v = filterTypeCssVars(type)
  return {
    backgroundColor: v.bg,
    borderColor: v.border,
    color: v.text,
  }
}

export function filterTypeDotStyle(type: FilterTermType): CSSProperties {
  return { backgroundColor: filterTypeCssVars(type).dot }
}

export type CustomChipFacet = {
  key: string
  label: string
  terms: FilteringTerm[]
}

function sortTermsByLabel(terms: FilteringTerm[]): FilteringTerm[] {
  return [...terms].sort((a, b) =>
    (a.label ?? a.id).localeCompare(b.label ?? b.id)
  )
}

/**
 * Split catalog custom terms into Explore chips.
 *
 * Tissue families become two chips (picker lists the ontologies):
 * - `tissueTop:*` → "Top 1% in tissue"
 * - `tissuePresent:*` → "Present in tissue"
 *
 * Other customs (e.g. expression.percentile, feature.biotypeFamily) stay one
 * chip per term. Dropped families (tissueHigh / tissueSpecific /
 * biosample.preset) are ignored if present in old packages.
 */
export function groupCustomTermsForChips(
  _scope: BeaconScope,
  terms: FilteringTerm[]
): CustomChipFacet[] {
  const tissueTop: FilteringTerm[] = []
  const tissuePresent: FilteringTerm[] = []
  const singles: FilteringTerm[] = []

  for (const term of terms) {
    const id = term.id.trim().toLowerCase()
    if (id.startsWith('tissuehigh:')) continue
    if (id.startsWith('tissuespecific:')) continue
    if (id.startsWith('biosample.preset:')) continue
    if (id.startsWith('tissuetop:')) {
      tissueTop.push(term)
      continue
    }
    if (id.startsWith('tissuepresent:')) {
      tissuePresent.push(term)
      continue
    }
    singles.push(term)
  }

  const out: CustomChipFacet[] = []

  if (tissueTop.length) {
    out.push({
      key: 'custom|tissueTop',
      label: 'Top 1% in tissue',
      terms: sortTermsByLabel(tissueTop),
    })
  }
  if (tissuePresent.length) {
    out.push({
      key: 'custom|tissuePresent',
      label: 'Present in tissue',
      terms: sortTermsByLabel(tissuePresent),
    })
  }

  for (const term of sortTermsByLabel(singles)) {
    out.push({
      key: `custom|term|${term.id}`,
      label: term.label?.trim() || term.id,
      terms: [term],
    })
  }

  return out
}

export function customFacetAsGroup(
  scope: BeaconScope,
  facet: CustomChipFacet
): NamespaceScopeGroup {
  return {
    key: facet.key,
    namespaceType: 'custom',
    namespaceLabel: facet.label,
    scope,
    terms: facet.terms,
    count: facet.terms.length,
    valueCount: facet.terms.length,
  }
}
