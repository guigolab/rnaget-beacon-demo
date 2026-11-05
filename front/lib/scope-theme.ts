import type { CSSProperties } from 'react'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'

/** Beacon filtering-term scopes used on the home catalog. */
export type BeaconScope = 'biosample' | 'genomicFeature' | 'matrix' | 'expressionValue'

export const BEACON_SCOPES: BeaconScope[] = [
  'biosample',
  'genomicFeature',
  'matrix',
  'expressionValue',
]

const TYPE_LABELS: Record<string, string> = {
  SO: 'Sequence Ontology',
  GO: 'Gene Ontology',
  OBI: 'Ontology for Biomedical Investigations',
  UBERON: 'Uberon',
  EFO: 'Experimental Factor Ontology',
  MONDO: 'Mondo Disease Ontology',
  HP: 'Human Phenotype Ontology',
  NCIT: 'NCI Thesaurus',
  UO: 'Units of Measurement Ontology',
}

export const SCOPE_LEGEND: Array<{
  scope: BeaconScope
  label: string
  hint: string
}> = [
  { scope: 'biosample', label: 'Tissues and samples', hint: 'Tissue & sample filters' },
  { scope: 'genomicFeature', label: 'Genes', hint: 'Gene & feature filters' },
  { scope: 'matrix', label: 'Matrices', hint: 'Expression matrices & catalogs' },
  {
    scope: 'expressionValue',
    label: 'Expression value',
    hint: 'Cell-level expression filters',
  },
]

export function entryTypeScope(entryId: string): BeaconScope {
  switch (entryId) {
    case 'biosample':
      return 'biosample'
    case 'feature':
      return 'genomicFeature'
    case 'matrix':
    case 'expressionValue':
      return 'matrix'
    default:
      return 'matrix'
  }
}

export function scopeCssVars(scope: BeaconScope): {
  bg: string
  border: string
  text: string
} {
  // Reuse matrix tokens until dedicated expressionValue theme vars exist.
  const tokenScope = scope === 'expressionValue' ? 'matrix' : scope
  return {
    bg: `var(--scope-${tokenScope}-bg)`,
    border: `var(--scope-${tokenScope}-border)`,
    text: `var(--scope-${tokenScope}-text)`,
  }
}

export function scopeChipStyle(scope: BeaconScope): CSSProperties {
  const v = scopeCssVars(scope)
  return {
    backgroundColor: v.bg,
    borderColor: v.border,
    color: v.text,
  }
}

export function isBeaconScope(value: string): value is BeaconScope {
  return (
    value === 'biosample' ||
    value === 'genomicFeature' ||
    value === 'matrix' ||
    value === 'expressionValue'
  )
}

export function namespaceLabel(
  type: string | undefined,
  termId: string,
  resources: FilteringResource[] = []
): string {
  const t = type ?? 'unknown'
  if (t === 'alphanumeric') {
    if (termId.includes('.')) return termId.split('.').pop() ?? termId
    return termId
  }
  if (t === 'custom') {
    return 'custom'
  }
  const fromResource = resources.find((r) => r.nameSpacePrefix === t)?.name
  if (fromResource) return fromResource
  return TYPE_LABELS[t] ?? t
}

export type NamespaceScopeGroup = {
  key: string
  namespaceType: string
  namespaceLabel: string
  scope: BeaconScope
  terms: FilteringTerm[]
  count: number
  valueCount: number
}

function termValueCount(term: FilteringTerm): number {
  return term.values?.length ?? 1
}

export function groupTermsByNamespaceScope(
  terms: FilteringTerm[],
  resources: FilteringResource[] = []
): NamespaceScopeGroup[] {
  const map = new Map<string, NamespaceScopeGroup>()

  for (const term of terms) {
    const scopes = term.scopes?.filter(isBeaconScope) ?? []
    if (scopes.length === 0) continue
    const namespaceType = term.type ?? 'unknown'
    const label = namespaceLabel(namespaceType, term.id, resources)

    for (const scope of scopes) {
      const key = `${namespaceType}|${scope}`
      let group = map.get(key)
      if (!group) {
        group = {
          key,
          namespaceType,
          namespaceLabel: label,
          scope,
          terms: [],
          count: 0,
          valueCount: 0,
        }
        map.set(key, group)
      }
      group.terms.push(term)
      group.count += 1
      group.valueCount += termValueCount(term)
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** Resource ids kept per scope — mirrors server filtering_terms(scopes=…). */
export const SCOPE_RESOURCE_IDS: Record<BeaconScope, ReadonlySet<string>> = {
  genomicFeature: new Set(['so', 'go', 'hgnc', 'ncbigene', 'ensembl', 'symbol']),
  biosample: new Set(['uberon', 'efo']),
  matrix: new Set(['so', 'obi']),
  expressionValue: new Set(),
}

export function resourceAllowedInScope(
  scope: BeaconScope,
  resource: FilteringResource
): boolean {
  const id = String(resource.id || '').toLowerCase()
  return Boolean(id && SCOPE_RESOURCE_IDS[scope].has(id))
}

/**
 * Home catalog namespaces: term-backed groups plus scoped `resources[]`.
 * Resource-only namespaces appear with empty `terms` (lookup / no catalogued values).
 */
export function groupHomeNamespaces(
  terms: FilteringTerm[],
  resources: FilteringResource[] = []
): NamespaceScopeGroup[] {
  const map = new Map<string, NamespaceScopeGroup>()
  for (const group of groupTermsByNamespaceScope(terms, resources)) {
    map.set(group.key, { ...group, terms: [...group.terms] })
  }

  for (const scope of BEACON_SCOPES) {
    const keep = SCOPE_RESOURCE_IDS[scope]
    for (const resource of resources) {
      const id = String(resource.id || '').toLowerCase()
      const prefix = resource.nameSpacePrefix
      if (!id || !prefix || !keep.has(id)) continue
      const key = `${prefix}|${scope}`
      if (map.has(key)) continue
      map.set(key, {
        key,
        namespaceType: prefix,
        namespaceLabel: resource.name || namespaceLabel(prefix, `${prefix}:`, resources),
        scope,
        terms: [],
        count: 0,
        valueCount: 0,
      })
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function countTermsForResourcePrefix(
  terms: FilteringTerm[],
  prefix: string | undefined
): number {
  if (!prefix) return 0
  return terms.filter((t) => {
    if (t.type === prefix) return true
    if (t.id.startsWith(`${prefix}:`)) return true
    return false
  }).length
}
