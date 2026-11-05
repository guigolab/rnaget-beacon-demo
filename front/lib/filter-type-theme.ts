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

/**
 * Split catalog custom terms into Explore chips: one chip per valued facet
 * (e.g. expression.percentile / feature.biotypeFamily). Dropped catalog families
 * (tissueHigh / tissueSpecific / biosample.preset) are ignored if present in
 * old packages.
 */
export function groupCustomTermsForChips(
  _scope: BeaconScope,
  terms: FilteringTerm[]
): CustomChipFacet[] {
  const singles: FilteringTerm[] = []

  for (const term of terms) {
    const id = term.id.trim().toLowerCase()
    if (id.startsWith('tissuehigh:')) continue
    if (id.startsWith('tissuespecific:')) continue
    if (id.startsWith('biosample.preset:')) continue
    singles.push(term)
  }

  const out: CustomChipFacet[] = []

  for (const term of [...singles].sort((a, b) =>
    (a.label ?? a.id).localeCompare(b.label ?? b.id)
  )) {
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
