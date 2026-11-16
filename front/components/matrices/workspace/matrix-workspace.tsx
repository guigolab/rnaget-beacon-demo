'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  windowPercentileColourValues,
  type MatrixColourMode,
} from '@/lib/heatmap-expression'
import { AXIS_STEP } from '@/lib/matrix-expression-slice'
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
  const [colourMode, setColourMode] = useState<MatrixColourMode>('value')
  const [featureCap, setFeatureCap] = useState(AXIS_STEP)
  const [biosampleCap, setBiosampleCap] = useState(AXIS_STEP)

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
  })

  // A new query starts again at the first 20 × 20 cells.
  const sliceQueryKey = `${candidates.featureIDList ?? ''}#${candidates.biosampleIDList ?? ''}#${query.minValue ?? ''}#${query.maxValue ?? ''}#${query.order}`
  useEffect(() => {
    setFeatureCap(AXIS_STEP)
    setBiosampleCap(AXIS_STEP)
  }, [sliceQueryKey, matrixId])

  const labels = useMatrixSliceLabels({
    matrixId,
    featureIds: slice.axes.featureIds,
    biosampleIds: slice.axes.biosampleIds,
    enabled: slice.status === 'ready',
  })
  const heatmapFeatures = labels.features
  const heatmapBiosamples = labels.biosamples

  const onVisibleBiosampleIds = useCallback((ids: string[]) => {
    setVisibleIds((prev) => (prev.join('|') === ids.join('|') ? prev : ids))
  }, [])

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
    if (slice.hasMoreFeatures) setFeatureCap((cap) => cap + AXIS_STEP)
  }, [slice.hasMoreFeatures])

  const valueRange = matrix.expressionValueRange
  const catalogMin = valueRange?.min
  const catalogMax = valueRange?.max
  const catalogReady =
    catalogMin != null &&
    catalogMax != null &&
    Number.isFinite(catalogMin) &&
    Number.isFinite(catalogMax)

  const colourValues = useMemo(() => {
    if (colourMode === 'value') return values
    return windowPercentileColourValues(
      values,
      heatmapFeatures,
      fetchBiosamples,
      colourMode
    )
  }, [colourMode, fetchBiosamples, heatmapFeatures, values])

  const range = useMemo(() => {
    if (colourMode !== 'value') return { min: 0, max: 100 }
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
    colourMode,
    fetchBiosamples,
    heatmapFeatures,
    values,
  ])

  const colorScale = useMemo(
    () =>
      colourMode === 'value'
        ? matrixHeatmapColorScaleBounds(valueRange, range.min, range.max)
        : { min: 0, max: 100 },
    [colourMode, range.max, range.min, valueRange]
  )

  const onClear = useCallback(() => {
    clearFilters(catalog.terms)
  }, [catalog.terms, clearFilters])

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
          colourMode={colourMode}
          onColourModeChange={setColourMode}
          featureShown={heatmapFeatures.length}
          featureTotal={0}
          biosampleShown={heatmapBiosamples.length}
          biosampleTotal={0}
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
          className="overflow-hidden rounded-lg border border-border bg-muted/20"
        >
          {!axesReady && !hasRows ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">Loading matrix axes…</p>
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
                heatmapBiosamples.length + (slice.hasMoreBiosamples ? 1 : 0)
              }
              values={values}
              colorValues={colourMode === 'value' ? undefined : colourValues}
              pendingKeys={pendingKeys}
              colorMin={colorScale.min}
              colorMax={colorScale.max}
              onVisibleBiosampleIds={onVisibleBiosampleIds}
              onNeedMoreColumns={onNeedMoreColumns}
              canLoadMoreFeatures={slice.hasMoreFeatures}
              onLoadMoreFeatures={onLoadMoreFeatures}
              loadingMoreFeatures={slice.loadingMore}
              featureTotal={0}
            />
          )}
        </div>
      </div>
    </section>
  )
}
