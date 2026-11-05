import {
  FEATURE_BIOTYPE_FAMILY_ID,
  isCustomId,
  matrixProfileSourceCustomFilter,
} from '@/lib/beacon/filters'
import type { FilteringResource, FilteringTerm, UiFilter } from '@/lib/beacon/types'
import {
  featurePercentileFilter,
  isFeaturePercentileThreshold,
  type FeaturePercentileThreshold,
} from '@/lib/expression-band'
import {
  resourceAllowedInScope,
  type BeaconScope,
} from '@/lib/scope-theme'

const FEATURE_LOOKUP_ORDER = [
  'symbol',
  'HGNC',
  'NCBIGene',
  'ENSEMBL',
  'GO',
] as const
const BIOSAMPLE_LOOKUP_ORDER = ['UBERON', 'EFO'] as const
const MATRIX_LOOKUP_ORDER = ['OBI', 'SO'] as const

const HIDDEN_TERM_IDS = new Set([
  'genomicfeature.symbol',
  'matrix.scale',
  'matrix.reproducible',
  'sex',
  'condition',
])

const DROPPED_BIOSAMPLE_ONTOLOGY = new Set([
  'GO',
  'HP',
  'MONDO',
  'NCIT',
  'OBI',
])
const BIOSAMPLE_STATUS_IDS = new Set(['efo:0009654', 'efo:0009655'])

export function isHiddenFilteringTerm(term: FilteringTerm): boolean {
  const id = term.id.trim().toLowerCase()
  if (!id) return true
  if (id.startsWith('expression.enrichedin:')) return true
  if (id.startsWith('tissuehigh:') || id.startsWith('tissuespecific:')) return true
  if (id.startsWith('biosample.preset:')) return true
  if (HIDDEN_TERM_IDS.has(id)) return true
  if (BIOSAMPLE_STATUS_IDS.has(id)) return true
  const scopes = term.scopes ?? []
  if (
    scopes.includes('biosample') &&
    !scopes.some((s) => s !== 'biosample') &&
    DROPPED_BIOSAMPLE_ONTOLOGY.has(String(term.type || '').toUpperCase())
  ) {
    return true
  }
  return false
}

/** Pretty-print machine catalog values for display (match wire stays unchanged). */
export function catalogValueDisplayLabel(termId: string, value: string): string {
  if (termId === 'matrix.profileSource') {
    const key = value.trim().toLowerCase()
    if (key === 'encode') return 'Encode'
    if (key === 'geo') return 'GEO'
    if (key === 'gtex') return 'GTEx'
  }
  return value
}

export function termToUiFilter(term: FilteringTerm): UiFilter {
  if (term.type === 'custom' || isCustomId(term.id)) {
    return { kind: 'custom', id: term.id, label: term.label }
  }
  if (term.type === 'alphanumeric' && term.id.startsWith('expression.')) {
    return { kind: 'expression', id: term.id, label: term.label }
  }
  if (term.type === 'alphanumeric') {
    const value = term.values?.[0] ?? ''
    return {
      kind: 'alphanumeric',
      id: term.id,
      value,
      label: term.label,
    }
  }
  return { kind: 'ontology', id: term.id, label: term.label }
}

/**
 * Expand a catalog term that carries enumerated `values` into clickable UiFilters.
 * Used for catalog-`custom` feature facets (percentile, biotypeFamily) whose request
 * wire is still alphanumeric/expression.
 */
export function valuedTermChips(term: FilteringTerm): UiFilter[] | null {
  const values = term.values ?? []
  if (!values.length) return null
  if (term.id === 'expression.percentile') {
    const chips: UiFilter[] = []
    for (const raw of values) {
      if (!isFeaturePercentileThreshold(raw)) continue
      chips.push(featurePercentileFilter(Number(raw) as FeaturePercentileThreshold))
    }
    return chips.length ? chips : null
  }
  if (term.id === FEATURE_BIOTYPE_FAMILY_ID) {
    const title = term.label ?? term.id
    return values.map((value) => ({
      kind: 'alphanumeric' as const,
      id: FEATURE_BIOTYPE_FAMILY_ID,
      value,
      label: `${title} = ${value}`,
    }))
  }
  if (term.id === 'matrix.profileSource') {
    const title = term.label ?? term.id
    return values.map((value) => {
      const display = catalogValueDisplayLabel(term.id, value)
      return matrixProfileSourceCustomFilter(value, `${title} = ${display}`)
    })
  }
  return null
}

export function browsableTerms(terms: FilteringTerm[]): FilteringTerm[] {
  return terms.filter((term) => !isHiddenFilteringTerm(term))
}

function cataloguedOntologyPrefixes(terms: FilteringTerm[]): Set<string> {
  const present = new Set<string>()
  for (const term of terms) {
    if (isHiddenFilteringTerm(term)) continue
    if (!term.type || term.type === 'alphanumeric' || term.type === 'custom') continue
    // Only count namespaces that actually list pickable terms.
    if (!(term.scopes?.length ?? 0)) continue
    present.add(term.type)
  }
  return present
}

/**
 * Resource namespaces with no catalogued term values for this scope
 * (GO, symbol, HGNC, …) — shown in the query-bar placeholder, not the accordion.
 */
export function resourceOnlyPrefixes(
  scope: BeaconScope,
  terms: FilteringTerm[],
  resources: FilteringResource[]
): string[] {
  const catalogued = cataloguedOntologyPrefixes(
    terms.filter((term) => term.scopes?.includes(scope) ?? false)
  )
  const out: string[] = []
  const seen = new Set<string>()
  for (const resource of resources) {
    if (!resourceAllowedInScope(scope, resource)) continue
    const prefix = resource.nameSpacePrefix?.trim()
    if (!prefix || seen.has(prefix) || catalogued.has(prefix)) continue
    seen.add(prefix)
    out.push(prefix)
  }
  return out
}

function orderedResourceOnly(
  preferred: readonly string[],
  resourceOnly: string[]
): string[] {
  const set = new Set(resourceOnly)
  const ordered: string[] = []
  for (const prefix of preferred) {
    if (set.has(prefix)) {
      ordered.push(prefix)
      set.delete(prefix)
    }
  }
  for (const prefix of [...set].sort((a, b) => a.localeCompare(b))) {
    ordered.push(prefix)
  }
  return ordered
}

/** Placeholder highlights type-in resource namespaces (no catalogued values). */
export function lensQueryPlaceholder(
  kind: 'feature' | 'biosample' | 'matrix',
  terms: FilteringTerm[],
  resources: FilteringResource[] = []
): string {
  if (!terms.length && !resources.length) return 'Add filter…'

  if (kind === 'feature') {
    const resourceOnly = orderedResourceOnly(
      FEATURE_LOOKUP_ORDER,
      resourceOnlyPrefixes('genomicFeature', terms, resources)
    )
    const parts = resourceOnly.map((prefix) =>
      prefix === 'symbol' ? 'symbol:…' : `${prefix}:…`
    )
    return parts.length ? parts.join(', ') : 'Symbol, HGNC:…, GO:…'
  }

  if (kind === 'biosample') {
    const resourceOnly = orderedResourceOnly(
      BIOSAMPLE_LOOKUP_ORDER,
      resourceOnlyPrefixes('biosample', terms, resources)
    )
    const parts = resourceOnly.map((prefix) => `${prefix}:…`)
    return parts.length ? parts.join(', ') : 'UBERON:…, EFO:…'
  }

  const resourceOnly = orderedResourceOnly(
    MATRIX_LOOKUP_ORDER,
    resourceOnlyPrefixes('matrix', terms, resources)
  )
  const parts = resourceOnly.map((prefix) => `${prefix}:…`)
  const unit = terms.find((term) => term.id === 'matrix.unit')
  if (unit?.values?.[0]) parts.unshift(unit.values[0])
  return parts.length ? parts.join(', ') : 'Unit, assay, feature type'
}
