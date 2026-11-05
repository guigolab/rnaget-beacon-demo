'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ExploreHeatmap } from '@/components/explore/explore-heatmap'
import { BiosampleQueryBar } from '@/components/samples/biosample-query-bar'
import { GeneFeatureQueryBar } from '@/components/genes/gene-feature-query-bar'
import { FilteringTermNamespaceChips } from '@/components/shared/filtering-term-namespace-chips'
import { FilterTypeLegend } from '@/components/shared/filter-type-legend'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { Button } from '@/components/ui/button'
import { EmptyState, PageFrame, PageHeader } from '@/components/ui-kit'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import { useLensList } from '@/hooks/use-lens-list'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import {
  dedupeFilters,
  filterKey,
  listFeatures,
  type Feature,
  type UiFilter,
} from '@/lib/beacon'
import {
  EXPLORE_LENS_PAGE_SIZE,
  exploreHeatmapFeatureFilters,
  exploreLensSearchParams,
  mergeExploreBiosampleFilters,
  mergeExploreFeatureFilters,
  parseExploreLensSearch,
  tissueOntologyIdsFromBiosampleFilters,
} from '@/lib/explore-lens'
import { partitionExploreBiosampleFilters } from '@/lib/explore-tissue-columns'
import type { LensProbe } from '@/lib/lens-preview-note'

const idleProbe: LensProbe = {
  exists: undefined,
  total: undefined,
  loading: false,
  error: '',
}

function ExploreLensContent() {
  const search = useSearchParams()
  const router = useRouter()
  const scopeIndex = useMergedFilterScopeIndex()
  const { terms, resources, loading: termsLoading, error: termsError } =
    useFilteringTerms('/filtering_terms')
  const lens = useMemo(
    () => parseExploreLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const { featureFilters, biosampleFilters } = lens

  const tissueSeedIds = useMemo(
    () => tissueOntologyIdsFromBiosampleFilters(biosampleFilters),
    [biosampleFilters]
  )
  const heatmapFilters = useMemo(
    () => exploreHeatmapFeatureFilters(featureFilters, biosampleFilters),
    [featureFilters, biosampleFilters]
  )
  const heatmapKeyLine = useMemo(
    () => heatmapFilters.map((filter) => filterKey(filter)).join('|'),
    [heatmapFilters]
  )
  const heatmapFiltersRef = useRef(heatmapFilters)
  heatmapFiltersRef.current = heatmapFilters

  const { constraintFilters } = useMemo(
    () => partitionExploreBiosampleFilters(biosampleFilters),
    [biosampleFilters]
  )
  /** Gene list needs feature filters or tissuePresent seeds. */
  const canFetch = heatmapFilters.length > 0
  /**
   * Mount heatmap (and Option A column probes) whenever genes can load or
   * non-tissue sample constraints are active.
   */
  const showHeatmap = canFetch || constraintFilters.length > 0
  const list = useLensList<Feature>({
    queryKey: heatmapKeyLine,
    pageSize: EXPLORE_LENS_PAGE_SIZE,
    enabled: canFetch,
    itemKey: (item) => item.id,
    fetchPage: (skip, limit, signal) =>
      listFeatures(skip, limit, {
        filters: heatmapFiltersRef.current,
        granularity: 'record',
        signal,
      }),
  })

  const writeState = useCallback(
    (nextFeature: UiFilter[], nextBiosample: UiFilter[]) => {
      const params = exploreLensSearchParams({
        featureFilters: dedupeFilters(nextFeature),
        biosampleFilters: dedupeFilters(nextBiosample),
        feature: null,
        index: scopeIndex,
      })
      router.replace(`/explore/?${params.toString()}`)
    },
    [router, scopeIndex]
  )

  const writeFeatureFilters = useCallback(
    (next: UiFilter[]) => writeState(next, biosampleFilters),
    [writeState, biosampleFilters]
  )
  const writeBiosampleFilters = useCallback(
    (next: UiFilter[]) => writeState(featureFilters, next),
    [writeState, featureFilters]
  )

  const canLoadMore =
    list.exists === true &&
    list.total != null &&
    list.items.length < list.total &&
    !list.loading &&
    !list.loadingMore

  const seedFocusOntologyId =
    tissueSeedIds.length === 1 ? tissueSeedIds[0] : null

  const featureProbe: LensProbe = {
    exists: canFetch ? list.exists : undefined,
    total: canFetch ? (list.total ?? undefined) : undefined,
    loading: canFetch && list.loading,
    error: list.error,
  }

  return (
    <PageFrame>
      <PageHeader
        title="Explore"
        description="Pick genes and/or tissues, then inspect within-tissue ≥99 / &lt;99 / not-in-matrix bands. Gene symbols are case-sensitive (Alb ≠ ALB). Sample tissues seed genes present in that tissue."
        legend={<FilterTypeLegend />}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Genes
            </h2>
            <div className="mt-2">
              <GeneFeatureQueryBar
                filters={featureFilters}
                onChange={writeFeatureFilters}
                probe={featureProbe}
                scopeIndex={scopeIndex}
                showExamples={false}
              />
            </div>
            <div className="mt-2">
              <FilteringTermNamespaceChips
                scope="genomicFeature"
                terms={terms}
                resources={resources}
                activeFilters={featureFilters}
                onAddFilter={(added) =>
                  writeFeatureFilters(
                    mergeExploreFeatureFilters(featureFilters, added)
                  )
                }
                loading={termsLoading}
                error={termsError}
              />
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tissues and samples
            </h2>
            <div className="mt-2">
              <BiosampleQueryBar
                filters={biosampleFilters}
                onChange={writeBiosampleFilters}
                probe={idleProbe}
                scopeIndex={scopeIndex}
                showExamples={false}
              />
            </div>
            <div className="mt-2">
              <FilteringTermNamespaceChips
                scope="biosample"
                terms={terms}
                resources={resources}
                activeFilters={biosampleFilters}
                onAddFilter={(added) =>
                  writeBiosampleFilters(
                    mergeExploreBiosampleFilters(biosampleFilters, added)
                  )
                }
                loading={termsLoading}
                error={termsError}
                hideSingleValueTerms
              />
            </div>
          </div>
        </section>
      </div>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-3">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Gene × tissue heatmap
            </h2>
            <div className="mt-1">
              <LensMutedEndpoints
                lines={[
                  'GET or POST /features · tissuePresent:',
                  'POST /matrices/{id}/biosamples · count (column refine)',
                ]}
              />
            </div>
          </div>
          {(featureFilters.length > 0 || biosampleFilters.length > 0) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => writeState([], [])}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="px-4 py-4">
          {!showHeatmap && (
            <EmptyState
              title="Start with a gene, tissue, or sample filter"
              description="Add a feature or UBERON/EFO tissue to load genes. Other biosample filters can refine which tissue columns appear (biosample count probes)."
            />
          )}

          {showHeatmap && canFetch && list.loading && !list.items.length && (
            <p className="text-sm text-muted-foreground">Loading genes…</p>
          )}

          {showHeatmap && canFetch && list.error && (
            <p className="text-sm text-destructive">{list.error}</p>
          )}

          {showHeatmap &&
            canFetch &&
            !list.loading &&
            !list.error &&
            list.items.length === 0 && (
              <p className="mb-3 text-sm text-muted-foreground">
                No genes match these filters. Tissue columns below still reflect
                sample filters.
              </p>
            )}

          {showHeatmap && !canFetch && (
            <p className="mb-3 text-sm text-muted-foreground">
              Refining tissue columns for sample filters. Add a gene or tissue to
              load expression bands.
            </p>
          )}

          {showHeatmap && (
            <>
              {list.refreshing && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Refreshing feature list…
                </p>
              )}
              <ExploreHeatmap
                features={list.items}
                terms={terms}
                biosampleFilters={biosampleFilters}
                featureFilters={featureFilters}
                selectedFeatureId={null}
                seedFocusOntologyId={seedFocusOntologyId}
                onAddFeatureFilter={(added) =>
                  writeFeatureFilters(
                    mergeExploreFeatureFilters(featureFilters, added)
                  )
                }
              />
              {canLoadMore && (
                <div className="mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={list.loadingMore}
                    onClick={() => list.loadMore()}
                  >
                    {list.loadingMore
                      ? 'Loading…'
                      : `Load more genes (${list.items.length.toLocaleString()}${
                          list.total != null
                            ? ` / ${list.total.toLocaleString()}`
                            : ''
                        })`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </PageFrame>
  )
}

export default function ExplorePage() {
  return (
    <LensPageShell>
      <ExploreLensContent />
    </LensPageShell>
  )
}
