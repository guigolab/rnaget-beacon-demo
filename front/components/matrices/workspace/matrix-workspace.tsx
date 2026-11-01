'use client'

import { Popover } from '@base-ui/react/popover'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MatrixHeatmapSummaryChart } from '@/components/matrices/matrix-heatmap-summary-chart'
import type { MatrixHeatmapViewMode } from '@/components/matrices/matrix-heatmap-view-toggle'
import { Button } from '@/components/ui/button'
import { useMatrixAxis } from '@/hooks/use-matrix-axis'
import { useMatrixCellValues } from '@/hooks/use-matrix-cell-values'
import { useMatrixFeatureSummaries } from '@/hooks/use-matrix-feature-summaries'
import { useMatrixQueryState } from '@/hooks/use-matrix-query-state'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import { scopeOf, type Matrix, type UiFilter } from '@/lib/beacon'
import type { Biosample, Feature } from '@/lib/beacon/types'
import { mergeGeneLensFilters } from '@/lib/gene-lens'
import { cellKey, matrixHeatmapColorScaleBounds, nativeFeatureId } from '@/lib/heatmap-expression'
import {
  biosampleIdListCsv,
  featureIdListCsv,
  type MatrixWorkspaceQuery,
} from '@/lib/matrix-workspace-query'
import { mergeSampleLensFilters } from '@/lib/sample-lens'
import { MatrixHeatmapGrid } from './matrix-heatmap-grid'
import {
  isolateFeaturePatch,
  matrixInspectTriggerId,
  MatrixInspectPopover,
  type MatrixInspect,
} from './matrix-inspect-popover'
import { MatrixQueryPanel } from './matrix-query-panel'
import {
  MATRIX_RESULTS_PANEL_ID,
  MatrixResultsToolbar,
  type MatrixSortChoice,
} from './matrix-results-toolbar'

const FEATURE_PAGE = 25
const BIOSAMPLE_PAGE = 50

function sortChoice(query: MatrixWorkspaceQuery): MatrixSortChoice {
  if (query.sort === 'expression.max') return 'max'
  if (query.sort === 'expression.min') return 'min'
  return 'id'
}

function sortPatch(choice: MatrixSortChoice): Pick<MatrixWorkspaceQuery, 'sort' | 'order'> {
  if (choice === 'max') return { sort: 'expression.max', order: 'desc' }
  if (choice === 'min') return { sort: 'expression.min', order: 'asc' }
  return { sort: 'id', order: 'asc' }
}

export function MatrixWorkspace({ matrix }: { matrix: Matrix }) {
  const matrixId = matrix.matrixId
  const popoverHandle = useMemo(() => Popover.createHandle(), [])
  const openedRef = useRef(false)
  const scopeIndex = useMergedFilterScopeIndex()
  const { query, queryKey, patch, clearFilters } = useMatrixQueryState(matrixId, scopeIndex)
  const [mode, setMode] = useState<MatrixHeatmapViewMode>('heatmap')
  const [inspect, setInspect] = useState<MatrixInspect | null>(null)
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  const featureIDList = featureIdListCsv(query)
  const biosampleIDList = biosampleIdListCsv(query)
  const featureRequestFilters = useMemo(
    () => [...query.featureFilters, ...query.biosampleFilters],
    [query.featureFilters, query.biosampleFilters]
  )

  const features = useMatrixAxis<Feature>({
    matrixId,
    axis: 'features',
    filters: featureRequestFilters,
    featureIDList,
    biosampleIDList,
    minValue: query.minValue,
    maxValue: query.maxValue,
    sort: query.sort,
    order: query.order,
    pageSize: FEATURE_PAGE,
  })
  const biosamples = useMatrixAxis<Biosample>({
    matrixId,
    axis: 'biosamples',
    filters: query.biosampleFilters,
    featureIDList,
    biosampleIDList,
    pageSize: BIOSAMPLE_PAGE,
  })

  const onVisibleBiosampleIds = useCallback((ids: string[]) => {
    setVisibleIds((prev) => (prev.join('|') === ids.join('|') ? prev : ids))
  }, [])

  const visibleBiosamples = useMemo(() => {
    if (!biosamples.items.length) return []
    if (!visibleIds.length) return biosamples.items.slice(0, 16)
    const wanted = new Set(visibleIds)
    const matched = biosamples.items.filter((sample) => wanted.has(sample.id))
    return matched.length ? matched : biosamples.items.slice(0, 16)
  }, [biosamples.items, visibleIds])

  const axesLoading = features.status === 'loading' || biosamples.status === 'loading'
  const cells = useMatrixCellValues({
    matrixId,
    features: features.items,
    biosamples: visibleBiosamples,
    minValue: query.minValue,
    maxValue: query.maxValue,
    enabled:
      mode === 'heatmap' &&
      !axesLoading &&
      features.items.length > 0 &&
      visibleBiosamples.length > 0,
  })

  const axesReady = features.status === 'ready' && biosamples.status === 'ready'
  const summaryFeatures = useMemo(() => {
    if (!axesReady) return []
    if (mode === 'summary') return features.items
    if (!inspect) return []
    const match = features.items.find((feature) => feature.id === inspect.featureId)
    return match ? [match] : []
  }, [axesReady, features.items, inspect, mode])
  const summaries = useMatrixFeatureSummaries(
    matrixId,
    summaryFeatures,
    query.biosampleFilters,
    summaryFeatures.length > 0
  )

  useEffect(() => {
    setInspect(null)
    if (openedRef.current) {
      openedRef.current = false
      popoverHandle.close()
    }
  }, [popoverHandle, queryKey])

  const openInspect = useCallback(
    (next: MatrixInspect) => {
      setInspect(next)
      openedRef.current = true
      queueMicrotask(() => popoverHandle.open(matrixInspectTriggerId(next)))
    },
    [popoverHandle]
  )

  const closeInspect = useCallback(() => {
    openedRef.current = false
    setInspect(null)
    popoverHandle.close()
  }, [popoverHandle])

  const onNeedMoreColumns = useCallback(() => {
    if (biosamples.hasMore && !biosamples.loadingMore) biosamples.loadMore()
  }, [biosamples.hasMore, biosamples.loadingMore, biosamples.loadMore])

  function addFilter(filter: UiFilter) {
    patch((current) => {
      if (filter.kind === 'symbol') {
        if (current.genes.some((gene) => gene.toUpperCase() === filter.value.toUpperCase())) {
          return current
        }
        return { genes: [...current.genes, filter.value] }
      }
      if (scopeOf(filter) === 'biosample') {
        return { biosampleFilters: mergeSampleLensFilters(current.biosampleFilters, filter) }
      }
      return { featureFilters: mergeGeneLensFilters(current.featureFilters, filter) }
    })
  }

  const catalog = matrix.expressionValueRange
  const catalogMin = catalog?.min
  const catalogMax = catalog?.max
  const catalogReady =
    catalogMin != null &&
    catalogMax != null &&
    Number.isFinite(catalogMin) &&
    Number.isFinite(catalogMax)

  const range = useMemo(() => {
    if (catalogReady && catalogMin != null && catalogMax != null) {
      return { min: catalogMin, max: catalogMax }
    }
    let min = Infinity
    let max = -Infinity
    for (const feature of features.items) {
      const featureId = nativeFeatureId(feature)
      for (const sample of visibleBiosamples) {
        const value = cells.values.get(cellKey(featureId, sample.id))
        if (value == null) continue
        if (value < min) min = value
        if (value > max) max = value
      }
    }
    if (!Number.isFinite(min)) return { min: 0, max: 0 }
    return { min, max }
  }, [catalogMax, catalogMin, catalogReady, cells.values, features.items, visibleBiosamples])

  const colorScale = useMemo(
    () => matrixHeatmapColorScaleBounds(catalog, range.min, range.max),
    [catalog, range.max, range.min]
  )

  const hasRows = features.items.length > 0 && biosamples.items.length > 0
  const error = features.error || biosamples.error || cells.error
  const loading = axesLoading || cells.loading || (mode === 'summary' && summaries.loading)
  const emptyLabel = (() => {
    if (features.status === 'ready' && !features.stale && features.items.length === 0) {
      return query.featureFilters.length || query.genes.length || query.featureIds.length || query.minValue != null || query.maxValue != null
        ? 'No features match these filters.'
        : 'This matrix has no features.'
    }
    if (biosamples.status === 'ready' && !biosamples.stale && biosamples.items.length === 0) {
      return query.biosampleFilters.length || query.biosampleIds.length
        ? 'No biosamples match these filters.'
        : 'This matrix has no biosamples.'
    }
    return ''
  })()

  return (
    <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:items-start">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:self-start">
        <div className="border-b border-border bg-muted/20 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Query</h2>
        </div>
        <div className="px-3 py-3">
          <MatrixQueryPanel
            matrix={matrix}
            query={query}
            onPatch={patch}
            onClear={clearFilters}
            featureCount={{
              loading: features.status !== 'ready' && !features.stale && !features.error,
              total: features.status === 'ready' || features.stale ? features.total : null,
            }}
            biosampleCount={{
              loading: biosamples.status !== 'ready' && !biosamples.stale && !biosamples.error,
              total: biosamples.status === 'ready' || biosamples.stale ? biosamples.total : null,
            }}
          />
        </div>
      </div>

      <div className={`min-w-0 space-y-3 ${features.stale || biosamples.stale ? 'opacity-80' : ''}`}>
        <MatrixResultsToolbar
          mode={mode}
          onModeChange={setMode}
          sort={sortChoice(query)}
          onSortChange={(choice) => patch(sortPatch(choice))}
          featureShown={features.items.length}
          featureTotal={features.total}
          biosampleShown={biosamples.items.length}
          biosampleTotal={biosamples.total}
          loading={loading}
          catalogMin={catalog?.min}
          catalogMax={catalog?.max}
          unit={matrix.expressionUnitAndScale?.unit}
        />

        {error && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                features.retry()
                biosamples.retry()
                cells.retry()
              }}
            >
              Retry
            </Button>
          </div>
        )}

        <div
          id={MATRIX_RESULTS_PANEL_ID}
          role="tabpanel"
          aria-labelledby={mode === 'heatmap' ? 'matrix-view-tab-heatmap' : 'matrix-view-tab-summary'}
          className="overflow-hidden rounded-lg border border-border bg-muted/20"
        >
          <Popover.Root
            handle={popoverHandle}
            onOpenChange={(open) => {
              if (!open) {
                openedRef.current = false
                setInspect(null)
              }
            }}
          >
            {axesLoading && !hasRows ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">Loading matrix…</p>
            ) : !hasRows ? (
              error ? null : (
                <div className="space-y-2 px-3 py-6">
                  <p className="text-sm text-muted-foreground">{emptyLabel || 'Nothing to show.'}</p>
                  <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              )
            ) : mode === 'summary' ? (
              <div>
                <MatrixHeatmapSummaryChart
                  features={summaryFeatures.length ? summaryFeatures : features.items}
                  getSummaryCell={summaries.getCell}
                  summariesLoading={summaries.loading}
                  matrixMin={catalog?.min}
                  matrixMax={catalog?.max}
                  filterMin={query.minValue}
                  filterMax={query.maxValue}
                  unit={matrix.expressionUnitAndScale?.unit}
                  popoverHandle={popoverHandle}
                  activeFeatureId={inspect?.kind === 'summary' ? inspect.featureId : null}
                  onBoxClick={(featureId) => openInspect({ kind: 'summary', featureId })}
                  featureRowTriggerId={(featureId) =>
                    matrixInspectTriggerId({ kind: 'summary', featureId })
                  }
                  onFeatureRowClick={(featureId) => openInspect({ kind: 'summary', featureId })}
                />
                {features.hasMore && (
                  <div className="border-t border-border px-3 py-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={features.loadingMore}
                      onClick={features.loadMore}
                    >
                      Load more features
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        {features.items.length.toLocaleString()} / {features.total.toLocaleString()}
                      </span>
                    </Button>
                  </div>
                )}
                {summaries.error && (
                  <p className="px-3 pb-2 text-xs text-destructive">{summaries.error}</p>
                )}
              </div>
            ) : (
              <MatrixHeatmapGrid
                features={features.items}
                biosamples={biosamples.items}
                columnTotal={biosamples.total}
                values={cells.values}
                pendingKeys={cells.pendingKeys}
                colorMin={colorScale.min}
                colorMax={colorScale.max}
                popoverHandle={popoverHandle}
                onInspect={openInspect}
                onVisibleBiosampleIds={onVisibleBiosampleIds}
                onNeedMoreColumns={onNeedMoreColumns}
                canLoadMoreFeatures={features.hasMore}
                onLoadMoreFeatures={features.loadMore}
                loadingMore={features.loadingMore}
                featureTotal={features.total}
              />
            )}
            <Popover.Portal>
              <Popover.Positioner
                side={inspect?.kind === 'summary' ? 'top' : 'bottom'}
                sideOffset={8}
                align={inspect?.kind === 'summary' ? 'center' : 'start'}
                className="z-[200]"
              >
                <Popover.Popup className="z-[200] w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
                  {inspect && (
                    <MatrixInspectPopover
                      inspect={inspect}
                      matrix={matrix}
                      features={features.items}
                      biosamples={biosamples.items}
                      featureFilters={query.featureFilters}
                      getSummaryCell={summaries.getCell}
                      onAddFilter={addFilter}
                      onIsolateFeature={(feature) => patch(isolateFeaturePatch(feature))}
                      onClose={closeInspect}
                    />
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
    </section>
  )
}
