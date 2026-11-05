'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import { useMatrixAxis } from '@/hooks/use-matrix-axis'
import { useMatrixCellValues } from '@/hooks/use-matrix-cell-values'
import { useMatrixQueryState } from '@/hooks/use-matrix-query-state'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import type { Biosample, Feature, Matrix } from '@/lib/beacon'
import {
  cellKey,
  matrixHeatmapColorScaleBounds,
  nativeFeatureId,
  windowPercentileColourValues,
  type MatrixColourMode,
} from '@/lib/heatmap-expression'
import {
  biosampleIdListCsv,
  catalogHasTopExpressedSeed,
  expressionPercentileValue,
  featureIdListCsv,
  MATRIX_BIOSAMPLE_PAGE_SIZE,
  MATRIX_FEATURE_PAGE_SIZE,
  matrixFeatureSideUnconstrained,
  TOP_EXPRESSED_PERCENTILE_VALUES,
  topExpressedPercentileFilter,
  withExpressionPercentileFilter,
  type TopExpressedPercentile,
} from '@/lib/matrix-workspace-query'
import { MatrixHeatmapGrid } from './matrix-heatmap-grid'
import { MatrixQueryPanel } from './matrix-query-panel'
import {
  MATRIX_RESULTS_PANEL_ID,
  MatrixResultsToolbar,
} from './matrix-results-toolbar'

export function MatrixWorkspace({ matrix }: { matrix: Matrix }) {
  const matrixId = matrix.matrixId
  const scopeIndex = useMergedFilterScopeIndex()
  const { query, patch, clearFilters } = useMatrixQueryState(matrixId, scopeIndex)
  const catalog = useFilteringTerms(
    `/matrices/${encodeURIComponent(matrixId)}/filtering_terms`
  )
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const [colourMode, setColourMode] = useState<MatrixColourMode>('value')
  const didSeedRef = useRef(false)

  // Seed Top 1% once when the empty URL has no feature constraints.
  useEffect(() => {
    if (didSeedRef.current || catalog.loading) return
    didSeedRef.current = true
    if (!catalogHasTopExpressedSeed(catalog.terms)) return
    if (!matrixFeatureSideUnconstrained(query)) return
    patch({
      featureFilters: [topExpressedPercentileFilter('99')],
    })
  }, [catalog.loading, catalog.terms, patch, query])

  const featureIDList = featureIdListCsv(query)
  const biosampleIDList = biosampleIdListCsv(query)

  const featureAxis = useMatrixAxis<Feature>({
    matrixId,
    axis: 'features',
    pageSize: MATRIX_FEATURE_PAGE_SIZE,
    filters: query.featureFilters,
    featureIDList,
  })

  const biosampleAxis = useMatrixAxis<Biosample>({
    matrixId,
    axis: 'biosamples',
    pageSize: MATRIX_BIOSAMPLE_PAGE_SIZE,
    filters: query.biosampleFilters,
    biosampleIDList,
  })

  const heatmapFeatures = featureAxis.items
  const heatmapBiosamples = biosampleAxis.items

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
    filters: query.expressionFilters,
    enabled:
      featureAxis.status === 'ready' &&
      biosampleAxis.status === 'ready' &&
      heatmapFeatures.length > 0 &&
      fetchBiosamples.length > 0,
  })

  const values = densify.values
  const pendingKeys = densify.pendingKeys

  const onNeedMoreColumns = useCallback(() => {
    if (biosampleAxis.hasMore && !biosampleAxis.loadingMore) {
      biosampleAxis.loadMore()
    }
  }, [biosampleAxis.hasMore, biosampleAxis.loadingMore, biosampleAxis.loadMore])

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

  const topExpressedOptions = useMemo(() => {
    const term = catalog.terms.find((item) => item.id === 'expression.percentile')
    const values = new Set(term?.values ?? [])
    return TOP_EXPRESSED_PERCENTILE_VALUES.filter((value) => values.has(value))
  }, [catalog.terms])

  const topExpressed = expressionPercentileValue(query.featureFilters)

  const onTopExpressedChange = useCallback(
    (value: TopExpressedPercentile | null) => {
      patch({
        featureFilters: withExpressionPercentileFilter(query.featureFilters, value),
        // Clear explicit gene picks when switching cohort so percentile applies cleanly.
        genes: value != null ? [] : query.genes,
        featureIds: value != null ? [] : query.featureIds,
      })
    },
    [patch, query.featureFilters, query.featureIds, query.genes]
  )

  const onClear = useCallback(() => {
    clearFilters(catalog.terms)
  }, [catalog.terms, clearFilters])

  const hasRows = heatmapFeatures.length > 0 && heatmapBiosamples.length > 0
  const error = featureAxis.error || biosampleAxis.error || densify.error
  const loading =
    featureAxis.status === 'loading' ||
    biosampleAxis.status === 'loading' ||
    densify.loading ||
    featureAxis.loadingMore ||
    biosampleAxis.loadingMore
  const axesReady =
    featureAxis.status === 'ready' && biosampleAxis.status === 'ready'
  const emptyLabel = axesReady && !hasRows ? 'No features or biosamples match this query.' : ''

  return (
    <section className="mt-6 space-y-6">
      <MatrixQueryPanel
        matrix={matrix}
        query={query}
        onPatch={patch}
        onClear={onClear}
        biosampleTotalFallback={biosampleAxis.total}
      />

      <div
        className={`min-w-0 space-y-3 ${
          featureAxis.loadingMore || biosampleAxis.loadingMore ? 'opacity-80' : ''
        }`}
      >
        <MatrixResultsToolbar
          topExpressed={topExpressed}
          topExpressedOptions={topExpressedOptions}
          onTopExpressedChange={onTopExpressedChange}
          colourMode={colourMode}
          onColourModeChange={setColourMode}
          featureShown={heatmapFeatures.length}
          featureTotal={featureAxis.total}
          biosampleShown={heatmapBiosamples.length}
          biosampleTotal={biosampleAxis.total}
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
                featureAxis.retry()
                biosampleAxis.retry()
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
              columnTotal={biosampleAxis.total}
              values={values}
              colorValues={colourMode === 'value' ? undefined : colourValues}
              pendingKeys={pendingKeys}
              colorMin={colorScale.min}
              colorMax={colorScale.max}
              onVisibleBiosampleIds={onVisibleBiosampleIds}
              onNeedMoreColumns={onNeedMoreColumns}
              canLoadMoreFeatures={featureAxis.hasMore}
              onLoadMoreFeatures={featureAxis.loadMore}
              loadingMoreFeatures={featureAxis.loadingMore}
              featureTotal={featureAxis.total}
            />
          )}
        </div>
      </div>
    </section>
  )
}
