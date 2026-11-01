'use client'

import {
  COLOR_HIGH,
  COLOR_LOW,
  COLOR_MID,
  COLOR_MID_LOW,
  COLOR_TOP,
} from '@/components/heatmap-colors'
import {
  MatrixHeatmapViewToggle,
  type MatrixHeatmapViewMode,
} from '@/components/matrices/matrix-heatmap-view-toggle'
import { formatHeatmapValue } from '@/lib/heatmap-expression'

export const MATRIX_RESULTS_PANEL_ID = 'matrix-results-panel'

export type MatrixSortChoice = 'id' | 'max' | 'min'

type MatrixResultsToolbarProps = {
  mode: MatrixHeatmapViewMode
  onModeChange: (mode: MatrixHeatmapViewMode) => void
  sort: MatrixSortChoice
  onSortChange: (sort: MatrixSortChoice) => void
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
  mode,
  onModeChange,
  sort,
  onSortChange,
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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MatrixHeatmapViewToggle
          value={mode}
          onChange={onModeChange}
          controls={MATRIX_RESULTS_PANEL_ID}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Sort
          <select
            aria-label="Sort features"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as MatrixSortChoice)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="id">Feature id</option>
            <option value="max">Highest maximum</option>
            <option value="min">Lowest minimum</option>
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
      </div>
      {mode === 'heatmap' && hasScale && (
        <div className="max-w-xs">
          <div
            className="h-2 w-full rounded-full"
            style={{ background: gradient }}
            role="img"
            aria-label={`Expression color scale ${formatHeatmapValue(catalogMin!)} to ${formatHeatmapValue(catalogMax!)}${unit ? ` ${unit}` : ''}`}
          />
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted-foreground">
            <span>
              {formatHeatmapValue(catalogMin!)}
              {unit ? ` ${unit}` : ''}
            </span>
            <span>
              {formatHeatmapValue(catalogMax!)}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
