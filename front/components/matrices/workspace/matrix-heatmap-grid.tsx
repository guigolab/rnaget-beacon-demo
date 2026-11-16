'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { COLOR_MISSING, COLOR_TEXT_DARK } from '@/components/heatmap-colors'
import {
  HeatmapMatrixCellEmpty,
  HeatmapMatrixCellLoading,
} from '@/components/heatmap-matrix-cell'
import { Button } from '@/components/ui/button'
import { EntityRecordLink } from '@/components/shared/entity-record-link'
import type { Biosample, Feature } from '@/lib/beacon/types'
import { featureDisplayLabel } from '@/lib/gene-lens'
import {
  cellKey,
  formatHeatmapValue,
  heatFill,
  heatTextColor,
  nativeFeatureId,
} from '@/lib/heatmap-expression'
import {
  HEATMAP_CELL_CLASS,
  HEATMAP_FEATURE_COL_CLASS,
  HEATMAP_FEW_BIOSAMPLE_MAX,
} from '@/lib/heatmap-table'
import { biosampleHeatmapColumnHeader } from '@/lib/sample-lens'

const BIO_COL_FALLBACK_PX = 72
const BIO_OVERSCAN = 4
/** Columns are fetched in blocks with one block of look-ahead each side. */
const BIO_FETCH_BLOCK = 8
const BIO_SCROLL_FETCH_PX = 240
/** Ignore sub-pixel / scrollbar flicker in ResizeObserver updates. */
const SIZE_EPSILON_PX = 2

type MatrixHeatmapGridProps = {
  features: Feature[]
  biosamples: Biosample[]
  columnTotal: number
  /** Raw expression values (labels). */
  values: Map<string, number>
  pendingKeys: Set<string>
  colorMin: number
  colorMax: number
  onVisibleBiosampleIds: (ids: string[]) => void
  onNeedMoreColumns: () => void
  canLoadMoreFeatures: boolean
  onLoadMoreFeatures: () => void
  loadingMoreFeatures: boolean
  featureTotal: number
}

export function MatrixHeatmapGrid({
  features,
  biosamples,
  columnTotal,
  values,
  pendingKeys,
  colorMin,
  colorMax,
  onVisibleBiosampleIds,
  onNeedMoreColumns,
  canLoadMoreFeatures,
  onLoadMoreFeatures,
  loadingMoreFeatures,
  featureTotal,
}: MatrixHeatmapGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLTableCellElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportW, setViewportW] = useState(0)
  const [colWidth, setColWidth] = useState(BIO_COL_FALLBACK_PX)

  const few =
    columnTotal > 0 &&
    columnTotal <= HEATMAP_FEW_BIOSAMPLE_MAX &&
    biosamples.length >= columnTotal
  // Lay out only loaded columns. Using full columnTotal as virtual width made the
  // table enormous and fought ResizeObserver/scrollbar measurements in a loop.
  const trackCount = biosamples.length
  const leadColumnId = biosamples[0]?.id ?? ''
  const viewport = viewportW || 800
  const start = few ? 0 : Math.max(0, Math.floor(scrollLeft / colWidth) - BIO_OVERSCAN)
  const end = few
    ? biosamples.length
    : Math.min(trackCount, Math.ceil((scrollLeft + viewport) / colWidth) + BIO_OVERSCAN)
  const visible = few ? biosamples : biosamples.slice(start, Math.min(end, biosamples.length))
  const padLeft = few ? 0 : start * colWidth
  const padRight = few ? 0 : Math.max(0, trackCount - end) * colWidth
  // Fetch window: whole blocks around the viewport, so small scrolls reuse the same
  // request and the next columns are already loading before they appear.
  const fetchStart = few ? 0 : Math.max(0, Math.floor(start / BIO_FETCH_BLOCK) * BIO_FETCH_BLOCK - BIO_FETCH_BLOCK)
  const fetchEnd = few
    ? biosamples.length
    : Math.min(biosamples.length, Math.ceil(end / BIO_FETCH_BLOCK) * BIO_FETCH_BLOCK + BIO_FETCH_BLOCK)
  const fetchKey = biosamples
    .slice(fetchStart, fetchEnd)
    .map((sample) => sample.id)
    .join('|')

  useEffect(() => {
    onVisibleBiosampleIds(fetchKey ? fetchKey.split('|') : [])
  }, [fetchKey, onVisibleBiosampleIds])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const width = Math.round(el.clientWidth)
      setViewportW((prev) => (Math.abs(prev - width) < SIZE_EPSILON_PX ? prev : width))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [biosamples.length, features.length])

  useEffect(() => {
    if (few) return
    const el = measureRef.current
    if (!el) return
    const update = () => {
      const width = Math.round(el.getBoundingClientRect().width)
      if (width < 32) return
      setColWidth((prev) => (Math.abs(prev - width) < SIZE_EPSILON_PX ? prev : width))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
    // Remeasure when the lead column identity changes (peak prepend), not on every
    // visible-window shift — that recreated observers and amplified layout thrash.
  }, [few, leadColumnId])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollLeft(el.scrollLeft)
    if (biosamples.length >= columnTotal) return
    const nearLoaded =
      biosamples.length > 0 &&
      el.scrollLeft + el.clientWidth >= biosamples.length * colWidth - BIO_SCROLL_FETCH_PX
    if (nearLoaded) onNeedMoreColumns()
  }, [biosamples.length, colWidth, columnTotal, onNeedMoreColumns])

  return (
    <div ref={scrollRef} className="overflow-x-auto" onScroll={onScroll}>
      <table
        className={
          few
            ? 'w-full table-fixed border-collapse text-xs'
            : 'w-full min-w-max border-collapse text-xs'
        }
        style={few ? undefined : { minWidth: `calc(9rem + ${trackCount * colWidth}px)` }}
      >
        <thead>
          <tr>
            <th
              className={`sticky left-0 top-0 z-[30] border-b border-r border-border bg-muted px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
                few ? HEATMAP_FEATURE_COL_CLASS : 'min-w-[9rem]'
              }`}
            >
              Feature
            </th>
            {padLeft > 0 && (
              <th
                aria-hidden
                className="border-0 p-0"
                style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft }}
              />
            )}
            {visible.map((sample, index) => {
              const columnId = sample.id
              const header = biosampleHeatmapColumnHeader(sample, visible)
              return (
                <th
                  key={columnId}
                  ref={index === 0 ? measureRef : undefined}
                  className="sticky top-0 z-[20] border-b border-border bg-muted px-0.5 py-1 text-center"
                  title={header.tooltip}
                >
                  <EntityRecordLink
                    kind="biosample"
                    id={columnId}
                    title="Open biosample details"
                    className={`mx-auto block w-full rounded-md px-1 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-background hover:text-foreground ${
                      few ? '' : 'max-w-[4.25rem]'
                    }`}
                  >
                    <span className="block truncate">{header.title}</span>
                    {header.subtitle && (
                      <span
                        className={`mt-0.5 block truncate text-[9px] font-normal ${
                          header.subtitleIsId ? 'font-mono' : ''
                        }`}
                      >
                        {header.subtitle}
                      </span>
                    )}
                  </EntityRecordLink>
                </th>
              )
            })}
            {padRight > 0 && (
              <th
                aria-hidden
                className="border-0 p-0"
                style={{ width: padRight, minWidth: padRight, maxWidth: padRight }}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {features.map((feature) => {
            // Stable axis key = expressionValue.featureId (native accession).
            // Wrapper Beacon id changes after label enrichment.
            const featureNativeId = nativeFeatureId(feature)
            const featureLabel = featureDisplayLabel(feature)
            return (
              <tr key={featureNativeId} className="group/row">
                <th
                  scope="row"
                  className={`sticky left-0 z-[25] border-r border-border bg-card px-1 py-0.5 text-left font-normal group-hover/row:bg-muted/30 ${
                    few ? HEATMAP_FEATURE_COL_CLASS : ''
                  }`}
                >
                  <EntityRecordLink
                    kind="feature"
                    id={feature.id}
                    title="Open feature details"
                    className="w-full max-w-[10rem] truncate rounded-md px-2 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/60 hover:underline"
                  >
                    {featureLabel}
                  </EntityRecordLink>
                </th>
                {padLeft > 0 && (
                  <td
                    aria-hidden
                    className="border-0 p-0"
                    style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft }}
                  />
                )}
                {visible.map((sample) => {
                  const columnId = sample.id
                  const key = cellKey(featureNativeId, columnId)
                  const value = values.get(key)
                  const hasValue = value !== undefined && Number.isFinite(value)
                  const fill = value
                  const hasFill = fill !== undefined && Number.isFinite(fill)
                  const isLoading = !hasValue && pendingKeys.has(key)
                  const background = hasFill
                    ? heatFill(fill, colorMin, colorMax)
                    : COLOR_MISSING
                  const color = hasFill
                    ? heatTextColor(fill, colorMin, colorMax)
                    : COLOR_TEXT_DARK
                  return (
                    <td key={columnId} className="border-b border-border/60 p-0.5">
                      {hasValue ? (
                        <div
                          title={`${featureLabel} · ${formatHeatmapValue(value)}`}
                          className={HEATMAP_CELL_CLASS}
                          style={{ backgroundColor: background, color }}
                        >
                          {formatHeatmapValue(value)}
                        </div>
                      ) : isLoading ? (
                        <HeatmapMatrixCellLoading />
                      ) : (
                        <HeatmapMatrixCellEmpty backgroundColor={background} color={color} />
                      )}
                    </td>
                  )
                })}
                {padRight > 0 && (
                  <td
                    aria-hidden
                    className="border-0 p-0"
                    style={{ width: padRight, minWidth: padRight, maxWidth: padRight }}
                  />
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {canLoadMoreFeatures && (
        <div className="sticky left-0 border-t border-border px-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={loadingMoreFeatures}
            onClick={onLoadMoreFeatures}
          >
            Load more genes
            {featureTotal > 0 && (
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                {features.length.toLocaleString()} / {featureTotal.toLocaleString()}
              </span>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
