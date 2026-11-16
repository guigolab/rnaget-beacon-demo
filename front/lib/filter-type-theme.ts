import type { CSSProperties } from 'react'
import type { FilteringTerm, UiFilter } from '@/lib/beacon/types'
import type { BeaconScope, NamespaceScopeGroup } from '@/lib/scope-theme'

/** Catalog filtering-term wire types used for Explore chip coloring. */
export type FilterTermType = 'ontology' | 'alphanumeric'

export const FILTER_TYPE_LEGEND: Array<{
  type: FilterTermType
  label: string
}> = [
  { type: 'ontology', label: 'Ontology' },
  { type: 'alphanumeric', label: 'Alphanumeric' },
]

/** Ontology filters are ontology-coloured; everything else is alphanumeric. */
export function filterTermTypeOf(filter: Pick<UiFilter, 'kind'>): FilterTermType {
  return filter.kind === 'ontology' ? 'ontology' : 'alphanumeric'
}

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

export type FacetChipGroup = {
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
 * Split alphanumeric facet terms into Explore chips.
 *
 * `tissue.percentile:<ontologyId>` terms (one per tissue) become a single chip
 * "Top 1% in tissue" whose picker lists the tissues. Other facets
 * (expression.percentile, feature.biotypeFamily) stay one chip per term.
 */
export function groupFacetTermsForChips(
  _scope: BeaconScope,
  terms: FilteringTerm[]
): FacetChipGroup[] {
  const tissueTop: FilteringTerm[] = []
  const singles: FilteringTerm[] = []

  for (const term of terms) {
    const id = term.id.trim().toLowerCase()
    if (id.startsWith('tissue.percentile:')) {
      tissueTop.push(term)
      continue
    }
    singles.push(term)
  }

  const out: FacetChipGroup[] = []

  if (tissueTop.length) {
    out.push({
      key: 'facet|tissuePercentile',
      label: 'Top 1% in tissue',
      terms: sortTermsByLabel(tissueTop),
    })
  }

  for (const term of sortTermsByLabel(singles)) {
    out.push({
      key: `facet|term|${term.id}`,
      label: term.label?.trim() || term.id,
      terms: [term],
    })
  }

  return out
}

export function facetAsGroup(
  scope: BeaconScope,
  facet: FacetChipGroup
): NamespaceScopeGroup {
  return {
    key: facet.key,
    namespaceType: 'facet',
    namespaceLabel: facet.label,
    scope,
    terms: facet.terms,
    count: facet.terms.length,
    valueCount: facet.terms.length,
  }
}
