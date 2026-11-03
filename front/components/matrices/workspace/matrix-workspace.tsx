'use client'

import { Popover } from '@base-ui/react/popover'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMatrixAxis } from '@/hooks/use-matrix-axis'
import { useMatrixCellValues } from '@/hooks/use-matrix-cell-values'
import { useMatrixQueryState } from '@/hooks/use-matrix-query-state'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import { scopeOf, type Matrix, type UiFilter } from '@/lib/beacon'
import type { Biosample, Feature } from '@/lib/beacon/types'
import { mergeGeneLensFilters } from '@/lib/gene-lens'
import {
  cellKey,
  matrixHeatmapColorScaleBounds,
  nativeFeatureId,
  preferLeadingBiosamples,
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

/** Feature axis page size: initial fetch and each load-more. */
const FEATURE_PAGE = 10
const BIOSAMPLE_PAGE = 20
const EMPTY_IDS: string[] = []

function sortChoice(query: MatrixWorkspaceQuery): MatrixSortChoice {
  return query.sort === 'expression.min' ? 'min' : 'max'
}

function sortPatch(choice: MatrixSortChoice): Pick<MatrixWorkspaceQuery, 'sort' | 'order'> {
  if (choice === 'min') return { sort: 'expression.min', order: 'asc' }
  return { sort: 'expression.max', order: 'desc' }
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

  const axesLoading = features.status === 'loading' || biosamples.status === 'loading'

  // Keep server feature order (expression.max / expression.min / id).
  const heatmapFeatures = features.items

  // Lead column = top row's packaged peak (or trough) biosample so top-left is the
  // matrix-wide extreme for that feature. Remaining columns stay in arrival order.
  const leadBiosampleId = useMemo(() => {
    const top = heatmapFeatures[0]
    const summary = top?.info?.expressionSummary
    if (!summary) return ''
    const id =
      query.sort === 'expression.min' ? summary.minBiosampleId : summary.maxBiosampleId
    return id?.trim() ?? ''
  }, [heatmapFeatures, query.sort])

  const leadBiosampleIds = useMemo(
    () => (leadBiosampleId ? [leadBiosampleId] : EMPTY_IDS),
    [leadBiosampleId]
  )

  const heatmapBiosamples = useMemo(
    () => preferLeadingBiosamples(biosamples.items, leadBiosampleIds),
    [biosamples.items, leadBiosampleIds]
  )

  // Fetch the visible column window only (lead peak is already first when present).
  const fetchBiosamples = useMemo(() => {
    if (!heatmapBiosamples.length) return []
    if (!visibleIds.length) {
      return heatmapBiosamples.slice(0, Math.min(BIOSAMPLE_PAGE, heatmapBiosamples.length))
    }
    const wanted = new Set(visibleIds)
    const matched = heatmapBiosamples.filter((sample) => wanted.has(sample.id))
    return matched.length
      ? matched
      : heatmapBiosamples.slice(0, Math.min(BIOSAMPLE_PAGE, heatmapBiosamples.length))
  }, [heatmapBiosamples, visibleIds])

  const cells = useMatrixCellValues({
    matrixId,
    features: heatmapFeatures,
    biosamples: fetchBiosamples,
    minValue: query.minValue,
    maxValue: query.maxValue,
    filters: query.expressionFilters,
    enabled: !axesLoading && heatmapFeatures.length > 0 && fetchBiosamples.length > 0,
  })

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
    if (colourMode === 'value') return cells.values
    return windowPercentileColourValues(
      cells.values,
      heatmapFeatures,
      fetchBiosamples,
      colourMode
    )
  }, [cells.values, colourMode, fetchBiosamples, heatmapFeatures])

  const range = useMemo(() => {
    if (colourMode !== 'value') return { min: 0, max: 100 }
    if (catalogReady && catalogMin != null && catalogMax != null) {
      return { min: catalogMin, max: catalogMax }
    }
    let min = Infinity
    let max = -Infinity
    for (const feature of features.items) {
      const featureId = nativeFeatureId(feature)
      for (const sample of fetchBiosamples) {
        const value = cells.values.get(cellKey(featureId, sample.id))
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
    cells.values,
    colourMode,
    features.items,
    fetchBiosamples,
  ])

  const colorScale = useMemo(
    () =>
      colourMode === 'value'
        ? matrixHeatmapColorScaleBounds(catalog, range.min, range.max)
        : { min: 0, max: 100 },
    [catalog, colourMode, range.max, range.min]
  )

  const hasRows = features.items.length > 0 && biosamples.items.length > 0
  const error = features.error || biosamples.error || cells.error
  const loading = axesLoading || cells.loading
  const emptyLabel = (() => {
    if (features.status === 'ready' && !features.stale && features.items.length === 0) {
      return query.featureFilters.length ||
        query.genes.length ||
        query.featureIds.length ||
        query.expressionFilters.length ||
        query.minValue != null ||
        query.maxValue != null
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
    <section className="mt-6 space-y-6">
      <MatrixQueryPanel
        matrix={matrix}
        query={query}
        onPatch={patch}
        onClear={clearFilters}
      />

      <div className={`min-w-0 space-y-3 ${features.stale || biosamples.stale ? 'opacity-80' : ''}`}>
        <MatrixResultsToolbar
          sort={sortChoice(query)}
          onSortChange={(choice) => patch(sortPatch(choice))}
          colourMode={colourMode}
          onColourModeChange={setColourMode}
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
            ) : (
              <MatrixHeatmapGrid
                features={heatmapFeatures}
                biosamples={heatmapBiosamples}
                columnTotal={biosamples.total}
                values={cells.values}
                colorValues={colourMode === 'value' ? undefined : colourValues}
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
              <Popover.Positioner side="bottom" sideOffset={8} align="start" className="z-[200]">
                <Popover.Popup className="z-[200] w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
                  {inspect && (
                    <MatrixInspectPopover
                      inspect={inspect}
                      matrix={matrix}
                      features={features.items}
                      biosamples={biosamples.items}
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
