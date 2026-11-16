'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import { useMatrixCandidates } from '@/hooks/use-matrix-candidates'
import { useMatrixCellValues } from '@/hooks/use-matrix-cell-values'
import { useMatrixExpressionSlice } from '@/hooks/use-matrix-expression-slice'
import { useMatrixQueryState } from '@/hooks/use-matrix-query-state'
import { useMatrixSliceLabels } from '@/hooks/use-matrix-slice-labels'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import type { Matrix } from '@/lib/beacon'
import {
  cellKey,
  matrixHeatmapColorScaleBounds,
  nativeFeatureId,
} from '@/lib/heatmap-expression'
import { AXIS_STEP, FEATURE_STEP } from '@/lib/matrix-expression-slice'
import { HEATMAP_FEW_BIOSAMPLE_MAX } from '@/lib/heatmap-table'
import { MatrixGridSkeleton } from './matrix-grid-skeleton'
import { MatrixHeatmapGrid } from './matrix-heatmap-grid'
import { MatrixQueryPanel } from './matrix-query-panel'
import {
  MATRIX_RESULTS_PANEL_ID,
  MatrixResultsToolbar,
} from './matrix-results-toolbar'

export function MatrixWorkspace({ matrix }: { matrix: Matrix }) {
  const matrixId = matrix.id
  const scopeIndex = useMergedFilterScopeIndex()
  const { query, patch, clearFilters } = useMatrixQueryState(matrixId, scopeIndex)
  const catalog = useFilteringTerms('/filtering_terms')
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const [featureCap, setFeatureCap] = useState(FEATURE_STEP)
  // Matrix dimensions are known up front: small matrices load every column at once
  // (full-width table, no layout jump); big ones start with one window.
  const dims = matrix.dimensions
  const initialBiosampleCap =
    dims?.biosamples != null && dims.biosamples > 0 && dims.biosamples <= HEATMAP_FEW_BIOSAMPLE_MAX
      ? dims.biosamples
      : AXIS_STEP
  const [biosampleCap, setBiosampleCap] = useState(initialBiosampleCap)

  // Typed genes / ontology filters narrow the candidate ids; with none, the ranked
  // expression_values slice below covers the whole matrix.
  const candidates = useMatrixCandidates(matrixId, query)
  const slice = useMatrixExpressionSlice({
    matrixId,
    order: query.order,
    minValue: query.minValue,
    maxValue: query.maxValue,
    featureIDList: candidates.featureIDList,
    biosampleIDList: candidates.biosampleIDList,
    featureCap,
    biosampleCap,
    enabled: candidates.status === 'ready' && !candidates.noMatch,
    // Filters are still resolving: keep the current grid instead of blanking it.
    holdWhenDisabled: candidates.status === 'loading',
  })

  // A new query starts again at the first 20 × 20 cells.
  const sliceQueryKey = `${candidates.featureIDList ?? ''}#${candidates.biosampleIDList ?? ''}#${query.minValue ?? ''}#${query.maxValue ?? ''}#${query.order}`
  useEffect(() => {
    setFeatureCap(FEATURE_STEP)
    setBiosampleCap(initialBiosampleCap)
  }, [sliceQueryKey, matrixId, initialBiosampleCap])

  const labels = useMatrixSliceLabels({
    matrixId,
    featureIds: slice.axes.featureIds,
    biosampleIds: slice.axes.biosampleIds,
    enabled: slice.status === 'ready',
  })
  const heatmapFeatures = labels.features
  const heatmapBiosamples = labels.biosamples

  // Scrolling reports a new column window on every frame; wait for it to settle so
  // fast scrolls do not cancel and restart the cell requests.
  const visibleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onVisibleBiosampleIds = useCallback((ids: string[]) => {
    if (visibleTimer.current) clearTimeout(visibleTimer.current)
    visibleTimer.current = setTimeout(() => {
      setVisibleIds((prev) => (prev.join('|') === ids.join('|') ? prev : ids))
    }, 120)
  }, [])
  useEffect(
    () => () => {
      if (visibleTimer.current) clearTimeout(visibleTimer.current)
    },
    []
  )

  const fetchBiosamples = useMemo(() => {
    if (!heatmapBiosamples.length) return []
    if (!visibleIds.length) return heatmapBiosamples
    const wanted = new Set(visibleIds)
    const matched = heatmapBiosamples.filter((sample) => wanted.has(sample.id))
    return matched.length ? matched : heatmapBiosamples
  }, [heatmapBiosamples, visibleIds])

  const densify = useMatrixCellValues({
    matrixId,
    features: heatmapFeatures,
    biosamples: fetchBiosamples,
    minValue: query.minValue,
    maxValue: query.maxValue,
    seed: slice.axes.values,
    enabled:
      slice.status === 'ready' &&
      heatmapFeatures.length > 0 &&
      fetchBiosamples.length > 0,
  })

  const values = densify.values
  const pendingKeys = densify.pendingKeys

  const onNeedMoreColumns = useCallback(() => {
    if (slice.hasMoreBiosamples) setBiosampleCap((cap) => cap + AXIS_STEP)
  }, [slice.hasMoreBiosamples])
  const onLoadMoreFeatures = useCallback(() => {
    if (slice.hasMoreFeatures) setFeatureCap((cap) => cap + FEATURE_STEP)
  }, [slice.hasMoreFeatures])

  const valueRange = matrix.expressionValueRange
  const catalogMin = valueRange?.min
  const catalogMax = valueRange?.max
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
    for (const feature of heatmapFeatures) {
      const featureId = nativeFeatureId(feature)
      for (const sample of fetchBiosamples) {
        const value = values.get(cellKey(featureId, sample.id))
        if (value == null) continue
        if (value < min) min = value
        if (value > max) max = value
      }
    }
    if (!Number.isFinite(min)) return { min: 0, max: 0 }
    return { min, max }
  }, [
    catalogMax,
    catalogMin,
    catalogReady,
    fetchBiosamples,
    heatmapFeatures,
    values,
  ])

  const colorScale = useMemo(
    () => matrixHeatmapColorScaleBounds(valueRange, range.min, range.max),
    [range.max, range.min, valueRange]
  )

  const onClear = useCallback(() => {
    clearFilters(catalog.terms)
  }, [catalog.terms, clearFilters])

  // Totals the grid can rely on from the first paint: the whole matrix when
  // unfiltered, otherwise the resolved candidate ids.
  const idCount = (list?: string) => (list ? list.split(',').length : 0)
  const featureTotalHint = candidates.featureIDList
    ? idCount(candidates.featureIDList)
    : (dims?.features ?? 0)
  const biosampleTotalHint = candidates.biosampleIDList
    ? idCount(candidates.biosampleIDList)
    : (dims?.biosamples ?? 0)
  const queryPending = candidates.status === 'loading' || slice.status === 'loading'
  const hasRows = heatmapFeatures.length > 0 && heatmapBiosamples.length > 0
  const error = candidates.error || slice.error || densify.error
  const loading =
    candidates.status === 'loading' ||
    slice.status === 'loading' ||
    densify.loading ||
    slice.loadingMore
  const axesReady =
    candidates.status === 'ready' &&
    (candidates.noMatch || slice.status === 'ready')
  const emptyLabel = axesReady && !hasRows ? 'No cells match this query.' : ''

  return (
    <section className="mt-6 space-y-6">
      <MatrixQueryPanel
        matrix={matrix}
        query={query}
        onPatch={patch}
        onClear={onClear}
        biosampleTotalFallback={heatmapBiosamples.length}
      />

      <div
        className={`min-w-0 space-y-3 ${
          slice.loadingMore ? 'opacity-80' : ''
        }`}
      >
        <MatrixResultsToolbar
          order={query.order}
          onOrderChange={(order) => patch({ order })}
          featureShown={heatmapFeatures.length}
          featureTotal={featureTotalHint}
          biosampleShown={heatmapBiosamples.length}
          biosampleTotal={biosampleTotalHint}
          loading={loading}
          catalogMin={valueRange?.min}
          catalogMax={valueRange?.max}
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
                slice.retry()
                densify.retry()
              }}
            >
              Retry
            </Button>
          </div>
        )}

        <div
          id={MATRIX_RESULTS_PANEL_ID}
          className="relative overflow-hidden rounded-lg border border-border bg-muted/20"
          aria-busy={loading}
        >
          <div
            aria-hidden
            className={`absolute inset-x-0 top-0 z-[40] h-0.5 overflow-hidden transition-opacity duration-200 ${
              loading ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="h-full w-1/3 animate-[matrix-progress_1.1s_ease-in-out_infinite] bg-primary/70" />
          </div>
          <div
            className={`transition-opacity duration-200 ${
              queryPending && hasRows ? 'opacity-55' : 'opacity-100'
            }`}
          >
          {!axesReady && !hasRows ? (
            <MatrixGridSkeleton
              featureTotal={featureTotalHint}
              biosampleTotal={biosampleTotalHint}
            />
          ) : !hasRows ? (
            error ? null : (
              <div className="space-y-2 px-3 py-6">
                <p className="text-sm text-muted-foreground">{emptyLabel || 'Nothing to show.'}</p>
                <Button type="button" size="sm" variant="outline" onClick={onClear}>
                  Clear filters
                </Button>
              </div>
            )
          ) : (
            <MatrixHeatmapGrid
              features={heatmapFeatures}
              biosamples={heatmapBiosamples}
              columnTotal={
                biosampleTotalHint > 0
                  ? biosampleTotalHint
                  : heatmapBiosamples.length + (slice.hasMoreBiosamples ? 1 : 0)
              }
              values={values}
              pendingKeys={pendingKeys}
              colorMin={colorScale.min}
              colorMax={colorScale.max}
              onVisibleBiosampleIds={onVisibleBiosampleIds}
              onNeedMoreColumns={onNeedMoreColumns}
              canLoadMoreFeatures={slice.hasMoreFeatures}
              onLoadMoreFeatures={onLoadMoreFeatures}
              loadingMoreFeatures={slice.loadingMore}
              featureTotal={featureTotalHint}
            />
          )}
          </div>
        </div>
      </div>
    </section>
  )
}
