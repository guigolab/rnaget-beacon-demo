import {
  FEATURE_BIOTYPE_FAMILY_ID,
  TISSUE_PERCENTILE_PREFIX,
  filterKey,
  filterLabel,
} from '@/lib/beacon/filters'
import type { FilteringResource, FilteringTerm, UiFilter } from '@/lib/beacon/types'
import {
  browsableTerms,
  filterForTermValue,
  termToUiFilter,
  valuedTermChips,
} from '@/lib/lens-catalog'
import type { FilterTermType } from '@/lib/filter-type-theme'
import { namespaceLabel } from '@/lib/scope-theme'

/** One pickable value inside a group (a chip the user can add). */
export type FilterGroupOption = {
  key: string
  label: string
  /** Secondary text (ontology id, sample count, …). */
  detail?: string
  filter: UiFilter
}

/**
 * A named family of filters shown as one popover. Each group answers one question
 * ("which gene type?", "top expressed in which tissue?") instead of mixing unrelated
 * catalog facets in one list.
 */
export type FilterGroup = {
  key: string
  label: string
  hint: string
  options: FilterGroupOption[]
  /** Catalog term type, for chip colours and the legend. */
  type: FilterTermType
  /** Long lists get a search box. */
  searchable: boolean
}

export type FilterAxis = 'feature' | 'biosample'

const BIOTYPE_FAMILY_LABELS: Record<string, string> = {
  protein_coding: 'Protein-coding',
  lncRNA: 'Long non-coding RNA',
  pseudogene: 'Pseudogene',
  sncRNA: 'Small non-coding RNA',
  other: 'Other feature classes',
}

const SEARCHABLE_FROM = 8

const BIOSAMPLE_GROUP_LABELS: Record<string, { label: string; hint: string }> = {
  UBERON: { label: 'Tissue', hint: 'Anatomy terms (Uberon)' },
  EFO: { label: 'Cell line & condition', hint: 'Experimental factors (EFO)' },
}

function inScope(term: FilteringTerm, scope: string): boolean {
  return term.scopes?.includes(scope) ?? false
}

function byLabel(a: FilterGroupOption, b: FilterGroupOption): number {
  return a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
}

function chipsOf(term: FilteringTerm | undefined): UiFilter[] {
  return (term && valuedTermChips(term)) || []
}

function group(
  key: string,
  label: string,
  hint: string,
  options: FilterGroupOption[],
  type: FilterTermType = 'alphanumeric'
): FilterGroup | null {
  if (!options.length) return null
  return { key, label, hint, options, type, searchable: options.length >= SEARCHABLE_FROM }
}

/** `Top 1% in blood (n=761)` → `{ label: 'blood', detail: 'n=761' }`. */
function tissueOption(term: FilteringTerm): FilterGroupOption {
  const tissueId = term.id.slice(TISSUE_PERCENTILE_PREFIX.length)
  const raw = term.label ?? tissueId
  const match = /^Top \d+% in (.*?)(?: \((n=\d+)\))?$/.exec(raw)
  const filter = termToUiFilter(term)
  return {
    key: term.id,
    label: match?.[1] || raw,
    detail: match?.[2],
    filter,
  }
}

function ontologyOptions(terms: FilteringTerm[]): FilterGroupOption[] {
  return terms
    .map((term) => ({
      key: term.id,
      label: term.label ?? term.id,
      detail: term.label && term.label !== term.id ? term.id : undefined,
      filter: termToUiFilter(term),
    }))
    .sort(byLabel)
}

function featureGroups(
  terms: FilteringTerm[],
  resources: FilteringResource[]
): FilterGroup[] {
  const scoped = browsableTerms(terms).filter((term) => inScope(term, 'genomicFeature'))
  const out: Array<FilterGroup | null> = []

  const biotype = scoped.find((term) => term.id === FEATURE_BIOTYPE_FAMILY_ID)
  out.push(
    group(
      'gene-type',
      'Gene type',
      'Coarse feature class',
      chipsOf(biotype)
        .map((filter) => {
          const value = filter.kind === 'alphanumeric' ? filter.value : ''
          return {
            key: `${FEATURE_BIOTYPE_FAMILY_ID}=${value}`,
            label: BIOTYPE_FAMILY_LABELS[value] ?? value,
            detail: value,
            filter,
          }
        })
        .sort(byLabel)
    )
  )

  const topExpressed = scoped.find((term) => term.id === 'expression.percentile')
  out.push(
    group(
      'top-expressed',
      'Top expressed',
      'Genes in the top percentile of this matrix',
      chipsOf(topExpressed).map((filter) => ({
        key: filterKey(filter),
        label: filterLabel(filter),
        filter,
      }))
    )
  )

  out.push(
    group(
      'top-in-tissue',
      'Top in tissue',
      'Top 1% of genes in one tissue, across matrices',
      scoped
        .filter((term) => term.id.startsWith(TISSUE_PERCENTILE_PREFIX))
        .map(tissueOption)
        .sort(byLabel)
    )
  )

  const resource = scoped.find((term) => term.id === 'feature.resource')
  out.push(
    group(
      'annotation',
      'Annotation',
      'Which gene annotation defines the feature',
      (resource?.values ?? []).map((value) => ({
        key: `feature.resource=${value}`,
        label: value,
        filter: filterForTermValue(resource!, value, `${resource!.label ?? resource!.id} = ${value}`),
      }))
    )
  )

  // One group per ontology namespace (GO, SO, …), named after the resource.
  const byType = new Map<string, FilteringTerm[]>()
  for (const term of scoped) {
    if (!term.type || term.type === 'alphanumeric') continue
    byType.set(term.type, [...(byType.get(term.type) ?? []), term])
  }
  for (const [type, list] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const name = namespaceLabel(type, list[0].id, resources)
    out.push(
      group(`ontology-${type}`, name, `${type} terms`, ontologyOptions(list), 'ontology')
    )
  }

  return out.filter((entry): entry is FilterGroup => entry != null)
}

function biosampleGroups(
  terms: FilteringTerm[],
  resources: FilteringResource[]
): FilterGroup[] {
  const scoped = browsableTerms(terms).filter(
    (term) => inScope(term, 'biosample') && term.type && term.type !== 'alphanumeric'
  )
  const byType = new Map<string, FilteringTerm[]>()
  for (const term of scoped) {
    byType.set(term.type!, [...(byType.get(term.type!) ?? []), term])
  }
  const out: FilterGroup[] = []
  for (const [type, list] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const known = BIOSAMPLE_GROUP_LABELS[type]
    const made = group(
      `ontology-${type}`,
      known?.label ?? namespaceLabel(type, list[0].id, resources),
      known?.hint ?? `${type} terms`,
      ontologyOptions(list),
      'ontology'
    )
    if (made) out.push(made)
  }
  return out
}

/** Split the filtering-term catalog into named, single-purpose filter groups. */
export function matrixFilterGroups(
  axis: FilterAxis,
  terms: FilteringTerm[],
  resources: FilteringResource[] = []
): FilterGroup[] {
  return axis === 'feature'
    ? featureGroups(terms, resources)
    : biosampleGroups(terms, resources)
}
