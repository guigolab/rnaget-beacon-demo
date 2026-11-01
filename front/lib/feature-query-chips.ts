import { filterKey, tokenToFilter } from '@/lib/beacon/filters'
import type { Feature, UiFilter } from '@/lib/beacon/types'

export type FeatureQueryChipKind = 'alias' | 'xref' | 'ontology'

export type FeatureQueryChip = {
  key: string
  kind: FeatureQueryChipKind
  label: string
  tooltip: string
  filter: UiFilter
}

function pushChip(
  chips: FeatureQueryChip[],
  seen: Set<string>,
  chip: FeatureQueryChip
) {
  const k = filterKey(chip.filter)
  if (seen.has(k)) return
  seen.add(k)
  chips.push(chip)
}

export function featureQueryChips(feature: Feature): FeatureQueryChip[] {
  const gf = feature.genomicFeature
  if (!gf) return []

  const chips: FeatureQueryChip[] = []
  const seen = new Set<string>()

  for (const raw of gf.aliases ?? []) {
    const text = raw.trim()
    if (!text) continue
    const filter = tokenToFilter(text, 'feature')
    if (!filter) continue
    pushChip(chips, seen, {
      key: `alias:${text}`,
      kind: 'alias',
      label: text,
      tooltip: `Alias · ${text}`,
      filter,
    })
  }

  for (const raw of gf.xrefs ?? []) {
    const text = raw.trim()
    if (!text) continue
    const filter = tokenToFilter(text, 'feature')
    if (!filter) continue
    pushChip(chips, seen, {
      key: `xref:${text}`,
      kind: 'xref',
      label: text,
      tooltip: `Xref · ${text}`,
      filter:
        filter.kind === 'ontology'
          ? { kind: 'ontology', id: filter.id }
          : filter,
    })
  }

  const ontologyEntries: Array<{ id: string; label?: string }> = []
  if (gf.featureType?.id) {
    ontologyEntries.push({
      id: gf.featureType.id,
      label: gf.featureType.label,
    })
  }
  for (const term of gf.ontologyTerms ?? []) {
    if (term.id) ontologyEntries.push({ id: term.id, label: term.label })
  }

  for (const term of ontologyEntries) {
    pushChip(chips, seen, {
      key: `ontology:${term.id}`,
      kind: 'ontology',
      label: term.label?.trim() || term.id,
      tooltip: term.id,
      filter: { kind: 'ontology', id: term.id, label: term.label },
    })
  }

  return chips
}
