import { geneLensQueryExamples } from '@/lib/gene-lens'
import { sampleLensQueryExamples } from '@/lib/sample-lens'
import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'

export function matrixHeatmapFilteringTermsPath(
  matrixId: string,
  axis: 'features' | 'biosamples'
): string {
  const enc = encodeURIComponent(matrixId)
  return axis === 'features'
    ? `/matrices/${enc}/features/filtering_terms`
    : `/matrices/${enc}/biosamples/filtering_terms`
}

export function matrixHeatmapFilteringTermsFallbackPath(
  axis: 'features' | 'biosamples'
): string {
  return axis === 'features' ? '/features/filtering_terms' : '/biosamples/filtering_terms'
}

export function matrixHeatmapFeatureExamples(
  terms: FilteringTerm[],
  previewFeatures: Feature[]
): Array<{ label: string; filter: UiFilter }> {
  const examples: Array<{ label: string; filter: UiFilter }> = []
  const seen = new Set<string>()

  for (const feature of previewFeatures) {
    if (examples.length >= 4) break
    const symbol =
      feature.genomicFeature?.aliases?.[0] ??
      feature.genomicFeature?.featureIdentifier?.id
    if (!symbol) continue
    const key = symbol.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    examples.push({ label: symbol, filter: { kind: 'symbol', value: symbol } })
  }

  const termIds = new Set(terms.map((term) => term.id.toLowerCase()))
  for (const term of terms) {
    if (examples.length >= 7) break
    if (term.type !== 'SO' && term.type !== 'GO') continue
    if (!termIds.has(term.id.toLowerCase())) continue
    if (examples.some((e) => e.filter.kind === 'ontology' && e.filter.id === term.id)) {
      continue
    }
    examples.push({
      label: term.label ?? term.id,
      filter: { kind: 'ontology', id: term.id, label: term.label },
    })
  }

  for (const example of geneLensQueryExamples(terms)) {
    if (examples.length >= 7) break
    const { filter } = example
    if (filter.kind === 'symbol') {
      if (seen.has(filter.value.toUpperCase())) continue
      seen.add(filter.value.toUpperCase())
      examples.push(example)
      continue
    }
    if (filter.kind === 'ontology' && termIds.has(filter.id.toLowerCase())) {
      if (examples.some((e) => e.filter.kind === 'ontology' && e.filter.id === filter.id)) {
        continue
      }
      examples.push(example)
    }
  }

  return examples.slice(0, 7)
}

export function matrixHeatmapBiosampleExamples(
  terms: FilteringTerm[]
): Array<{ label: string; filter: UiFilter }> {
  return sampleLensQueryExamples(terms)
}
