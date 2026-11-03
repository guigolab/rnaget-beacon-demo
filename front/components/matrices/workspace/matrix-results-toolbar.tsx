'use client'

import {
  COLOR_HIGH,
  COLOR_LOW,
  COLOR_MID,
  COLOR_MID_LOW,
  COLOR_TOP,
} from '@/components/heatmap-colors'
import { formatHeatmapValue } from '@/lib/heatmap-expression'
import type { MatrixColourMode } from '@/lib/heatmap-expression'

export const MATRIX_RESULTS_PANEL_ID = 'matrix-results-panel'

export type MatrixSortChoice = 'max' | 'min'

type MatrixResultsToolbarProps = {
  sort: MatrixSortChoice
  onSortChange: (sort: MatrixSortChoice) => void
  colourMode: MatrixColourMode
  onColourModeChange: (mode: MatrixColourMode) => void
  featureShown: number
  featureTotal: number
  biosampleShown: number
  biosampleTotal: number
  loading: boolean
  catalogMin?: number
  catalogMax?: number
  unit?: string
}

export function MatrixResultsToolbar({
  sort,
  onSortChange,
  colourMode,
  onColourModeChange,
  featureShown,
  featureTotal,
  biosampleShown,
  biosampleTotal,
  loading,
  catalogMin,
  catalogMax,
  unit,
}: MatrixResultsToolbarProps) {
  const gradient = `linear-gradient(90deg, ${COLOR_LOW}, ${COLOR_MID_LOW}, ${COLOR_MID}, ${COLOR_HIGH}, ${COLOR_TOP})`
  const percentileMode = colourMode !== 'value'
  const hasScale = percentileMode
    ? true
    : catalogMin != null &&
      catalogMax != null &&
      Number.isFinite(catalogMin) &&
      Number.isFinite(catalogMax)
  const featureLabel =
    featureTotal > 0
      ? `${featureShown.toLocaleString()} / ${featureTotal.toLocaleString()} features`
      : `${featureShown.toLocaleString()} features`
  const biosampleLabel =
    biosampleTotal > 0
      ? `${biosampleShown.toLocaleString()} / ${biosampleTotal.toLocaleString()} biosamples`
      : `${biosampleShown.toLocaleString()} biosamples`
  const scaleMinLabel = percentileMode ? '0' : formatHeatmapValue(catalogMin!)
  const scaleMaxLabel = percentileMode ? '100' : formatHeatmapValue(catalogMax!)
  const scaleUnit = percentileMode ? '%' : unit ? ` ${unit}` : ''
  const scaleAria = percentileMode
    ? `Window percentile color scale 0 to 100 (${colourMode === 'percentileInFeature' ? 'within feature' : 'within biosample'})`
    : `Expression color scale ${scaleMinLabel} to ${scaleMaxLabel}${unit ? ` ${unit}` : ''}`

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Sort
        <select
          aria-label="Sort features"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as MatrixSortChoice)}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="max">Highest maximum</option>
          <option value="min">Lowest minimum</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Colour
        <select
          aria-label="Heatmap colour mode"
          value={colourMode}
          onChange={(event) =>
            onColourModeChange(event.target.value as MatrixColourMode)
          }
          className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="value">Value</option>
          <option value="percentileInFeature">Window % in feature</option>
          <option value="percentileInBiosample">Window % in biosample</option>
        </select>
      </label>
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        {featureLabel}
        {' · '}
        {biosampleLabel}
        {percentileMode ? ' · window percentile' : ''}
      </p>
      {loading && (
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
          Loading…
        </span>
      )}
      {hasScale && (
        <div className="ml-auto w-full max-w-[12rem] sm:w-44">
          <div
            className="h-2 w-full rounded-full"
            style={{ background: gradient }}
            role="img"
            aria-label={scaleAria}
          />
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted-foreground">
            <span>
              {scaleMinLabel}
              {scaleUnit}
            </span>
            <span>
              {scaleMaxLabel}
              {scaleUnit}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
