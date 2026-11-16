'use client'

import {
  COLOR_HIGH,
  COLOR_LOW,
  COLOR_MID,
  COLOR_MID_LOW,
  COLOR_TOP,
} from '@/components/heatmap-colors'
import { MatrixHeatmapHelp } from './matrix-heatmap-help'
import { formatHeatmapValue } from '@/lib/heatmap-expression'

export const MATRIX_RESULTS_PANEL_ID = 'matrix-results-panel'

type MatrixResultsToolbarProps = {
  order: 'asc' | 'desc'
  onOrderChange: (order: 'asc' | 'desc') => void
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
  order,
  onOrderChange,
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
  const hasScale =
    catalogMin != null &&
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
  const scaleMinLabel = hasScale ? formatHeatmapValue(catalogMin!) : ''
  const scaleMaxLabel = hasScale ? formatHeatmapValue(catalogMax!) : ''
  const scaleUnit = unit ? ` ${unit}` : ''
  const scaleAria = `Expression color scale ${scaleMinLabel} to ${scaleMaxLabel}${scaleUnit}`

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <MatrixHeatmapHelp />
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Sort
        <select
          aria-label="Sort expression values"
          value={order}
          onChange={(event) => onOrderChange(event.target.value === 'asc' ? 'asc' : 'desc')}
          className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="desc">Highest first</option>
          <option value="asc">Lowest first</option>
        </select>
      </label>
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        {featureLabel}
        {' · '}
        {biosampleLabel}
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
