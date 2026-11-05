'use client'

import { Popover } from '@base-ui/react/popover'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMatrixCellValues } from '@/hooks/use-matrix-cell-values'
import { useMatrixExpressionSlice } from '@/hooks/use-matrix-expression-slice'
import { useMatrixQueryState } from '@/hooks/use-matrix-query-state'
import { useMatrixSliceLabels } from '@/hooks/use-matrix-slice-labels'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import { scopeOf, type Matrix, type UiFilter } from '@/lib/beacon'
import { mergeGeneLensFilters } from '@/lib/gene-lens'
import {
  cellKey,
  matrixHeatmapColorScaleBounds,
  nativeFeatureId,
  windowPercentileColourValues,
  type MatrixColourMode,
} from '@/lib/heatmap-expression'
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

function sortChoice(query: MatrixWorkspaceQuery): MatrixSortChoice {
  return query.sort === 'expression.min' ? 'min' : 'max'
}

function sortPatch(choice: MatrixSortChoice): Pick<MatrixWorkspaceQuery, 'sort' | 'order'> {
  if (choice === 'min') return { sort: 'expression.min', order: 'asc' }
  return { sort: 'expression.max', order: 'desc' }
}

function sliceOrder(query: MatrixWorkspaceQuery): 'asc' | 'desc' {
  return query.sort === 'expression.min' ? 'asc' : 'desc'
}

export function MatrixWorkspace({ matrix }: { matrix: Matrix }) {
  const matrixId = matrix.matrixId
  const popoverHandle = useMemo(() => Popover.createHandle(), [])
  const openedRef = useRef(false)
  const scopeIndex = useMergedFilterScopeIndex()
  const { query, queryKey, patch, clearFilters } = useMatrixQueryState(matrixId, scopeIndex)
  const [inspect, setInspect] = useState<MatrixInspect | null>(null)
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const [colourMode, setColourMode] = useState<MatrixColourMode>('value')

  const featureIDList = featureIdListCsv(query)
  const biosampleIDList = biosampleIdListCsv(query)
  const sliceFilters = useMemo(
    () => [
      ...query.featureFilters,
      ...query.biosampleFilters,
      ...query.expressionFilters,
    ],
    [query.biosampleFilters, query.expressionFilters, query.featureFilters]
  )

  const slice = useMatrixExpressionSlice({
    matrixId,
    order: sliceOrder(query),
    minValue: query.minValue,
    maxValue: query.maxValue,
    filters: sliceFilters,
    featureIDList,
    biosampleIDList,
  })

  const labels = useMatrixSliceLabels({
    matrixId,
    featureIds: slice.axes.featureIds,
    biosampleIds: slice.axes.biosampleIds,
    enabled: slice.status === 'ready' && slice.axes.featureIds.length > 0,
  })

  const heatmapFeatures = labels.features
  const heatmapBiosamples = labels.biosamples

  const onVisibleBiosampleIds = useCallback((ids: string[]) => {
    setVisibleIds((prev) => (prev.join('|') === ids.join('|') ? prev : ids))
  }, [])

  // Densify the visible column window (full derived axes when few / not scrolled).
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
      slice.status === 'ready' &&
      heatmapFeatures.length > 0 &&
      fetchBiosamples.length > 0,
  })

  const values = useMemo(() => {
    const merged = new Map(slice.axes.values)
    for (const [key, value] of densify.values) merged.set(key, value)
    return merged
  }, [densify.values, slice.axes.values])

  const pendingKeys = useMemo(() => {
    const pending = new Set<string>()
    for (const key of densify.pendingKeys) {
      if (!slice.axes.values.has(key)) pending.add(key)
    }
    return pending
  }, [densify.pendingKeys, slice.axes.values])

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
    if (slice.hasMore && !slice.loadingMore) slice.loadMore()
  }, [slice.hasMore, slice.loadingMore, slice.loadMore])

  function addFilter(filter: UiFilter) {
    patch((current) => {
      if (filter.kind === 'symbol') {
        if (current.genes.some((gene) => gene.toUpperCase() === filter.value.toUpperCase())) {
          return current
        }
        return { genes: [...current.genes, filter.value] }
      }
      if (
        filter.kind === 'custom' &&
        filter.id.toLowerCase().startsWith('symbol:')
      ) {
        const symbol = filter.id.slice(filter.id.indexOf(':') + 1).trim()
        if (!symbol) return current
        if (current.genes.some((gene) => gene.toUpperCase() === symbol.toUpperCase())) {
          return current
        }
        return { genes: [...current.genes, symbol] }
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
        ? matrixHeatmapColorScaleBounds(catalog, range.min, range.max)
        : { min: 0, max: 100 },
    [catalog, colourMode, range.max, range.min]
  )

  const hasRows = heatmapFeatures.length > 0 && heatmapBiosamples.length > 0
  const error = slice.error || densify.error
  const loading = slice.status === 'loading' || densify.loading || slice.loadingMore
  const emptyLabel =
    slice.status === 'ready' && !hasRows
      ? 'No expression values match this slice.'
      : ''

  return (
    <section className="mt-6 space-y-6">
      <MatrixQueryPanel
        matrix={matrix}
        query={query}
        onPatch={patch}
        onClear={clearFilters}
      />

      <div className={`min-w-0 space-y-3 ${slice.loadingMore ? 'opacity-80' : ''}`}>
        <MatrixResultsToolbar
          sort={sortChoice(query)}
          onSortChange={(choice) => patch(sortPatch(choice))}
          colourMode={colourMode}
          onColourModeChange={setColourMode}
          featureShown={heatmapFeatures.length}
          featureTotal={heatmapFeatures.length}
          biosampleShown={heatmapBiosamples.length}
          biosampleTotal={heatmapBiosamples.length}
          cellTotal={slice.total}
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
          <Popover.Root
            handle={popoverHandle}
            onOpenChange={(open) => {
              if (!open) {
                openedRef.current = false
                setInspect(null)
              }
            }}
          >
            {slice.status === 'loading' && !hasRows ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">Loading expression slice…</p>
            ) : !hasRows ? (
              error ? null : (
                <div className="space-y-2 px-3 py-6">
                  <p className="text-sm text-muted-foreground">{emptyLabel || 'Nothing to show.'}</p>
                  <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              )
            ) : (
              <MatrixHeatmapGrid
                features={heatmapFeatures}
                biosamples={heatmapBiosamples}
                columnTotal={heatmapBiosamples.length}
                values={values}
                colorValues={colourMode === 'value' ? undefined : colourValues}
                pendingKeys={pendingKeys}
                colorMin={colorScale.min}
                colorMax={colorScale.max}
                popoverHandle={popoverHandle}
                onInspect={openInspect}
                onVisibleBiosampleIds={onVisibleBiosampleIds}
                onNeedMoreColumns={onNeedMoreColumns}
                canLoadMoreCells={slice.hasMore}
                onLoadMoreCells={slice.loadMore}
                loadingMore={slice.loadingMore}
                cellTotal={slice.total}
              />
            )}
            <Popover.Portal>
              <Popover.Positioner side="bottom" sideOffset={8} align="start" className="z-[200]">
                <Popover.Popup className="z-[200] w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
                  {inspect && (
                    <MatrixInspectPopover
                      inspect={inspect}
                      matrix={matrix}
                      features={heatmapFeatures}
                      biosamples={heatmapBiosamples}
                      featureFilters={query.featureFilters}
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
