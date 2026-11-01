'use client'

import { formatHeatmapValue } from '@/lib/heatmap-expression'

type MatrixExpressionRangeBarProps = {
  min?: number
  max?: number
  median?: number
  unit?: string
}

export function MatrixExpressionRangeBar({
  min,
  max,
  median,
  unit,
}: MatrixExpressionRangeBarProps) {
  const hasRange =
    min != null &&
    max != null &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max > min
  const marker =
    hasRange && median != null && Number.isFinite(median)
      ? Math.max(0, Math.min(1, (median - min) / (max - min)))
      : null

  return (
    <div className="space-y-1">
      {hasRange ? (
        <>
          <div className="flex justify-between gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{formatHeatmapValue(min!)}</span>
            <span>{formatHeatmapValue(max!)}</span>
          </div>
          <div
            className="relative h-2 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={
              median != null
                ? `Median ${formatHeatmapValue(median)} between matrix min and max`
                : 'Matrix expression range'
            }
          >
            <div className="absolute inset-0 bg-gradient-to-r from-muted via-primary/20 to-primary/35" />
            {marker != null && (
              <div
                className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded-full bg-primary shadow-sm ring-2 ring-background"
                style={{ left: `calc(${marker * 100}% - 2px)` }}
              />
            )}
          </div>
        </>
      ) : (
        <div className="h-2 rounded-full bg-muted" title="Matrix min/max not available" />
      )}
      {median != null && Number.isFinite(median) && (
        <p className="text-[10px] text-muted-foreground">
          Median{' '}
          <span className="font-medium tabular-nums text-foreground">
            {formatHeatmapValue(median)}
          </span>
          {unit ? ` ${unit}` : ''}
          {hasRange && marker != null ? ` · ${Math.round(marker * 100)}% of matrix range` : ''}
        </p>
      )}
    </div>
  )
}
