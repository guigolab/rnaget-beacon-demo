'use client'

import type { ExpressionSummary } from '@/lib/beacon/client'
import { MatrixExpressionRangeBar } from '@/components/genes/matrix-expression-range-bar'
import { formatHeatmapValue } from '@/lib/heatmap-expression'

type ExpressionCohortStatsVisualProps = {
  summary: ExpressionSummary
  median?: number
  matrixMin?: number
  matrixMax?: number
  unit?: string
}

function scaleX(value: number, min: number, max: number, width: number, pad: number) {
  const t = (value - min) / (max - min)
  return pad + t * (width - pad * 2)
}

export function ExpressionCohortStatsVisual({
  summary,
  median,
  matrixMin,
  matrixMax,
  unit,
}: ExpressionCohortStatsVisualProps) {
  const med = median ?? summary.median
  const single = summary.n === 1

  if (single && med != null && Number.isFinite(med)) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--scope-genomicFeature-border)]/30 bg-[var(--scope-genomicFeature-bg)]/40 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Single biosample (n = 1)
              </p>
              <p className="font-mono text-xl font-semibold tabular-nums text-foreground">
                {formatHeatmapValue(med)}
                {unit ? (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {unit}
                  </span>
                ) : null}
              </p>
            </div>
            {(matrixMin != null || matrixMax != null) && (
              <div className="min-w-[8rem] flex-1">
                <MatrixExpressionRangeBar
                  min={matrixMin}
                  max={matrixMax}
                  median={med}
                  unit={unit}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const lo = summary.min
  const hi = summary.max
  const q1 = summary.q1
  const q3 = summary.q3
  const hasBox =
    lo != null &&
    hi != null &&
    q1 != null &&
    q3 != null &&
    med != null &&
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    hi > lo

  const W = 300
  const H = 52
  const pad = 12
  const trackY = H / 2

  return (
    <div className="space-y-3">
      {hasBox && (
        <div className="rounded-lg border border-border bg-muted/20 px-2 py-2.5">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Cohort (n = {summary.n.toLocaleString()})
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full text-foreground"
            role="img"
            aria-label="Horizontal cohort box plot"
          >
            <line
              x1={scaleX(lo, lo, hi, W, pad)}
              y1={trackY}
              x2={scaleX(hi, lo, hi, W, pad)}
              y2={trackY}
              stroke="currentColor"
              strokeWidth={1.5}
              opacity={0.45}
            />
            <rect
              x={Math.min(scaleX(q1, lo, hi, W, pad), scaleX(q3, lo, hi, W, pad))}
              y={trackY - 12}
              width={Math.max(
                4,
                Math.abs(scaleX(q3, lo, hi, W, pad) - scaleX(q1, lo, hi, W, pad))
              )}
              height={24}
              className="fill-primary/25 stroke-primary"
              strokeWidth={1.5}
              rx={3}
            />
            <line
              x1={scaleX(med!, lo, hi, W, pad)}
              y1={trackY - 14}
              x2={scaleX(med!, lo, hi, W, pad)}
              y2={trackY + 14}
              stroke="currentColor"
              strokeWidth={2.5}
            />
            {summary.mean != null && Number.isFinite(summary.mean) && (
              <circle
                cx={scaleX(summary.mean, lo, hi, W, pad)}
                cy={trackY}
                r={4}
                className="fill-amber-500/90"
              />
            )}
            <text x={pad} y={10} className="fill-muted-foreground text-[8px]">
              {formatHeatmapValue(lo)}
            </text>
            <text x={W - pad - 28} y={10} className="fill-muted-foreground text-[8px]">
              {formatHeatmapValue(hi)}
            </text>
          </svg>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {summary.mean != null && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] tabular-nums">
                μ {formatHeatmapValue(summary.mean)}
              </span>
            )}
            {med != null && (
              <span className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] tabular-nums">
                med {formatHeatmapValue(med)}
              </span>
            )}
            {q1 != null && q3 != null && (
              <span className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] tabular-nums">
                IQR {formatHeatmapValue(q1)}–{formatHeatmapValue(q3)}
              </span>
            )}
          </div>
        </div>
      )}

      {!hasBox && med != null && (
        <p className="text-muted-foreground">
          Median{' '}
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatHeatmapValue(med)}
          </span>
          {unit ? ` ${unit}` : ''} · n = {summary.n.toLocaleString()}
        </p>
      )}

      {(matrixMin != null || matrixMax != null) && med != null && !single && (
        <div>
          <p className="mb-1 text-[10px] font-medium text-muted-foreground">
            Median vs matrix range
          </p>
          <MatrixExpressionRangeBar
            min={matrixMin}
            max={matrixMax}
            median={med}
            unit={unit}
          />
        </div>
      )}
    </div>
  )
}
