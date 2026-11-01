import type { FilteringTerm, UiFilter } from '@/lib/beacon'
import { filterLabel } from '@/lib/beacon/filters'

export function catalogLabelById(terms: FilteringTerm[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const term of terms) {
    if (!term.id) continue
    const label = term.label?.trim()
    if (label) map.set(term.id.toLowerCase(), label)
  }
  return map
}

export function filterChipDisplay(
  filter: UiFilter,
  catalog: Map<string, string>
): { text: string; tooltip?: string } {
  if (filter.kind === 'ontology' || filter.kind === 'custom') {
    const fromCatalog = catalog.get(filter.id.toLowerCase())
    const text = filter.label?.trim() || fromCatalog || filter.id
    return { text, tooltip: filter.id }
  }
  if (filter.kind === 'symbol') {
    return { text: filter.value, tooltip: 'Gene symbol' }
  }
  if (filter.kind === 'alphanumeric') {
    const text = filter.label?.trim() || filterLabel(filter)
    return { text, tooltip: `${filter.id} = ${filter.value}` }
  }
  return { text: filterLabel(filter) }
}
