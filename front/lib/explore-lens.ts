import {
  catalogSearchParams,
  dedupeFilters,
  isFeatureLensFilter,
  parseCatalogSearch,
  scopeOf,
  type FilterScopeIndex,
  type UiFilter,
} from '@/lib/beacon'
import { isTissueOrCellOntologyId } from '@/lib/biosample-ontology-grid'
import { mergeGeneLensFilters } from '@/lib/gene-lens'
import { mergeSampleLensFilters } from '@/lib/sample-lens'

export const EXPLORE_LENS_PAGE_SIZE = 5
/** @deprecated Explore biosample seed uses tissuePresent; kept for API callers. */
export const TISSUE_TOP_PREFIX = 'tissueTop:'
export const TISSUE_PRESENT_PREFIX = 'tissuePresent:'

export type ExploreLensSearch = {
  featureFilters: UiFilter[]
  biosampleFilters: UiFilter[]
  feature: string | null
}

function isExploreBiosampleFilter(
  filter: UiFilter,
  index?: FilterScopeIndex
): boolean {
  return scopeOf(filter, index) === 'biosample'
}

/** Tissue column ids implied by biosample UBERON/EFO ontology filters. */
export function tissueOntologyIdsFromBiosampleFilters(
  biosampleFilters: UiFilter[]
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const filter of biosampleFilters) {
    if (filter.kind !== 'ontology') continue
    const oid = filter.id
    if (!isTissueOrCellOntologyId(oid)) continue
    const key = oid.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(oid)
  }
  return out
}

export function tissueTopFilter(ontologyId: string): UiFilter {
  return {
    kind: 'custom',
    id: `${TISSUE_TOP_PREFIX}${ontologyId}`,
    label: `Top 1% in ${ontologyId}`,
  }
}

export function tissuePresentFilter(ontologyId: string): UiFilter {
  return {
    kind: 'custom',
    id: `${TISSUE_PRESENT_PREFIX}${ontologyId}`,
    label: `Present in ${ontologyId}`,
  }
}

/**
 * Feature filters for Explore heatmap fetch. URL feature filters plus synthetic
 * ``tissuePresent:{oid}`` for each tissue implied by biosample filters. Do not
 * write tissuePresent into the URL — compose at fetch time only.
 */
export function exploreHeatmapFeatureFilters(
  featureFilters: UiFilter[],
  biosampleFilters: UiFilter[]
): UiFilter[] {
  const derived = tissueOntologyIdsFromBiosampleFilters(biosampleFilters).map(
    (oid) => tissuePresentFilter(oid)
  )
  return dedupeFilters([...featureFilters, ...derived])
}

export function parseExploreLensSearch(
  params: URLSearchParams,
  index?: FilterScopeIndex
): ExploreLensSearch {
  const { filters } = parseCatalogSearch(params)
  const featureFilters = dedupeFilters(
    filters.filter((f) => isFeatureLensFilter(f, index))
  )
  const biosampleFilters = dedupeFilters(
    filters.filter((f) => isExploreBiosampleFilter(f, index))
  )
  return {
    featureFilters,
    biosampleFilters,
    feature: params.get('feature'),
  }
}

export function exploreLensSearchParams(opts: {
  featureFilters: UiFilter[]
  biosampleFilters: UiFilter[]
  feature?: string | null
  index?: FilterScopeIndex
}): URLSearchParams {
  const featureOnly = dedupeFilters(
    opts.featureFilters.filter((f) => isFeatureLensFilter(f, opts.index))
  )
  const sampleOnly = dedupeFilters(
    opts.biosampleFilters.filter((f) => isExploreBiosampleFilter(f, opts.index))
  )
  const base = catalogSearchParams({
    filters: [...featureOnly, ...sampleOnly],
    granularity: 'record',
  })
  base.delete('granularity')
  base.delete('skip')
  base.delete('limit')
  if (opts.feature) base.set('feature', opts.feature)
  else base.delete('feature')
  return base
}

export function mergeExploreFeatureFilters(
  current: UiFilter[],
  added: UiFilter
): UiFilter[] {
  return mergeGeneLensFilters(current, added)
}

export function mergeExploreBiosampleFilters(
  current: UiFilter[],
  added: UiFilter
): UiFilter[] {
  return mergeSampleLensFilters(current, added)
}

export function partitionExploreFilter(
  filter: UiFilter,
  index?: FilterScopeIndex
): 'feature' | 'biosample' | 'other' {
  if (isFeatureLensFilter(filter, index)) return 'feature'
  if (isExploreBiosampleFilter(filter, index)) return 'biosample'
  return 'other'
}
