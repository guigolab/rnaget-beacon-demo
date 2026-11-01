import type { CSSProperties } from 'react'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'

/** Beacon filtering-term scopes used on the home catalog. */
export type BeaconScope = 'biosample' | 'genomicFeature' | 'matrix'

export const BEACON_SCOPES: BeaconScope[] = ['biosample', 'genomicFeature', 'matrix']

const TYPE_LABELS: Record<string, string> = {
  SO: 'Sequence Ontology',
  OBI: 'Ontology for Biomedical Investigations',
  UBERON: 'Uberon',
  EFO: 'Experimental Factor Ontology',
}

export const SCOPE_LEGEND: Array<{
  scope: BeaconScope
  label: string
  hint: string
}> = [
  { scope: 'biosample', label: 'Biosample', hint: 'Sample metadata & facets' },
  { scope: 'genomicFeature', label: 'Genomic feature', hint: 'Genes & feature filters' },
  { scope: 'matrix', label: 'Matrix', hint: 'Expression matrices & summaries' },
]

export function entryTypeScope(entryId: string): BeaconScope {
  switch (entryId) {
    case 'biosample':
      return 'biosample'
    case 'feature':
      return 'genomicFeature'
    case 'matrix':
    case 'expressionValue':
    case 'expressionSummary':
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
  return {
    bg: `var(--scope-${scope}-bg)`,
    border: `var(--scope-${scope}-border)`,
    text: `var(--scope-${scope}-text)`,
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
  return value === 'biosample' || value === 'genomicFeature' || value === 'matrix'
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
    const m = termId.match(/^resource:(.+)$/)
    return m ? m[1] : termId
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

export function groupTermsByNamespaceScope(terms: FilteringTerm[]): NamespaceScopeGroup[] {
  const map = new Map<string, NamespaceScopeGroup>()

  for (const term of terms) {
    const scopes = term.scopes?.filter(isBeaconScope) ?? []
    if (scopes.length === 0) continue
    const namespaceType = term.type ?? 'unknown'
    const label = namespaceLabel(namespaceType, term.id)

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
