'use client'

import { Popover } from '@base-ui/react/popover'
import { useMemo } from 'react'
import { featureDisplayLabel } from '@/lib/gene-lens'
import { EntityRecordLink } from '@/components/shared/entity-record-link'
import type { FeatureMatrixCell } from '@/lib/feature-expression-grid'
import { formatHeatmapValue } from '@/lib/heatmap-expression'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Feature } from '@/lib/beacon/types'

const PAD_LEFT = 52
const PAD_RIGHT = 16
const PAD_TOP = 16
const PAD_BOTTOM = 8
const PLOT_H = 300
const COL_W = 56
type MatrixHeatmapSummaryChartProps = {
  features: Feature[]
  getSummaryCell: (featureId: string) => FeatureMatrixCell | undefined
  summariesLoading: boolean
  matrixMin?: number
  matrixMax?: number
  filterMin?: number
  filterMax?: number
  unit?: string
  popoverHandle: ReturnType<typeof Popover.createHandle>
  activeFeatureId?: string | null
  onBoxClick: (featureId: string) => void
  featureRowTriggerId: (featureId: string) => string
  onFeatureRowClick: (featureId: string) => void
}

/** Y increases downward; higher expression → smaller y (top of plot). */
function scaleY(
  value: number,
  lo: number,
  hi: number,
  plotTop: number,
  plotHeight: number
): number {
  if (hi <= lo) return plotTop + plotHeight / 2
  const t = (value - lo) / (hi - lo)
  return plotTop + (1 - Math.max(0, Math.min(1, t))) * plotHeight
}

/** Y scale for boxplots: cohort data + filter inputs — not full matrix catalog (avoids squashing). */
function computePlotDomain(
  filterMin: number | undefined,
  filterMax: number | undefined,
  summaries: (ExpressionSummary | undefined)[]
): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  const touch = (v?: number) => {
    if (v == null || !Number.isFinite(v)) return
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  touch(filterMin)
  touch(filterMax)
  for (const s of summaries) {
    if (!s) continue
    touch(s.min)
    touch(s.max)
    touch(s.median)
    touch(s.q1)
    touch(s.q3)
    touch(s.mean)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 }

  const allowNegativeAxis = filterMin != null && filterMin < 0

  if (lo === hi) {
    const bump = Math.max(Math.abs(lo) * 0.08, 1)
    const loOut = allowNegativeAxis ? lo - bump : Math.max(0, lo - bump)
    return { lo: loOut, hi: hi + bump }
  }
  const pad = (hi - lo) * 0.08 || 1
  const loOut = allowNegativeAxis ? lo - pad : Math.max(0, lo - pad)
  const hiOut = hi + pad
  return loOut < hiOut ? { lo: loOut, hi: hiOut } : { lo: loOut, hi: loOut + 1 }
}

function thresholdLineY(
  value: number,
  lo: number,
  hi: number,
  plotTop: number,
  plotHeight: number
): { y: number; offScale: 'above' | 'below' | null } {
  if (value > hi) return { y: plotTop + 2, offScale: 'above' }
  if (value < lo) return { y: plotTop + plotHeight - 2, offScale: 'below' }
  return { y: scaleY(value, lo, hi, plotTop, plotHeight), offScale: null }
}

function ThresholdLegend({
  matrixMin,
  matrixMax,
  filterMin,
  filterMax,
  unit,
}: {
  matrixMin?: number
  matrixMax?: number
  filterMin?: number
  filterMax?: number
  unit?: string
}) {
  const hasMatrix =
    matrixMin != null &&
    matrixMax != null &&
    Number.isFinite(matrixMin) &&
    Number.isFinite(matrixMax)
  const hasFilterMin = filterMin != null && Number.isFinite(filterMin)
  const hasFilterMax = filterMax != null && Number.isFinite(filterMax)

  if (!hasMatrix && !hasFilterMin && !hasFilterMax) return null

  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 border-b border-border/60 pb-2 text-[10px] text-muted-foreground">
      {hasMatrix && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded-full bg-primary/70" aria-hidden />
          Matrix catalog{' '}
          <span className="font-mono tabular-nums text-foreground">
            {formatHeatmapValue(matrixMin!)} – {formatHeatmapValue(matrixMax!)}
          </span>
          {unit ? ` ${unit}` : ''}
        </span>
      )}
      {(hasFilterMin || hasFilterMax) && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded-full bg-amber-600" aria-hidden />
          Filter threshold
          {hasFilterMin && (
            <span className="font-mono tabular-nums text-foreground">
              min {formatHeatmapValue(filterMin!)}
            </span>
          )}
          {hasFilterMin && hasFilterMax && ' · '}
          {hasFilterMax && (
            <span className="font-mono tabular-nums text-foreground">
              max {formatHeatmapValue(filterMax!)}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

function VerticalBoxPlot({
  summary,
  cx,
  lo,
  hi,
  plotTop,
  plotHeight,
}: {
  summary: ExpressionSummary
  cx: number
  lo: number
  hi: number
  plotTop: number
  plotHeight: number
}) {
  const med = summary.median
  const q1 = summary.q1
  const q3 = summary.q3
  const minV = summary.min
  const maxV = summary.max
  const boxHalfW = 14

  const hasBox =
    minV != null &&
    maxV != null &&
    q1 != null &&
    q3 != null &&
    med != null &&
    Number.isFinite(minV) &&
    Number.isFinite(maxV) &&
    maxV > minV

  if (!hasBox) {
    if (med != null && Number.isFinite(med)) {
      const y = scaleY(med, lo, hi, plotTop, plotHeight)
      return <circle cx={cx} cy={y} r={4} className="fill-primary" />
    }
    return null
  }

  const yMin = scaleY(minV!, lo, hi, plotTop, plotHeight)
  const yMax = scaleY(maxV!, lo, hi, plotTop, plotHeight)
  const yQ1 = scaleY(q1!, lo, hi, plotTop, plotHeight)
  const yQ3 = scaleY(q3!, lo, hi, plotTop, plotHeight)
  const yMed = scaleY(med!, lo, hi, plotTop, plotHeight)
  const boxTop = Math.min(yQ1, yQ3)
  const boxH = Math.max(4, Math.abs(yQ3 - yQ1))

  return (
    <g>
      <line
        x1={cx}
        y1={yMax}
        x2={cx}
        y2={yMin}
        stroke="currentColor"
        strokeWidth={1.25}
        opacity={0.45}
      />
      <rect
        x={cx - boxHalfW}
        y={boxTop}
        width={boxHalfW * 2}
        height={boxH}
        rx={3}
        className="fill-primary/20 stroke-primary"
        strokeWidth={1.25}
      />
      <line
        x1={cx - boxHalfW}
        y1={yMed}
        x2={cx + boxHalfW}
        y2={yMed}
        stroke="currentColor"
        strokeWidth={2.5}
      />
      {summary.mean != null && Number.isFinite(summary.mean) && (
        <circle
          cx={cx}
          cy={scaleY(summary.mean, lo, hi, plotTop, plotHeight)}
          r={3.5}
          className="fill-amber-500"
        />
      )}
    </g>
  )
}

export function MatrixHeatmapSummaryChart({
  features,
  getSummaryCell,
  summariesLoading,
  matrixMin,
  matrixMax,
  filterMin,
  filterMax,
  unit,
  popoverHandle,
  activeFeatureId,
  onBoxClick,
  featureRowTriggerId,
  onFeatureRowClick,
}: MatrixHeatmapSummaryChartProps) {
  const summaries = useMemo(
    () => features.map((f) => getSummaryCell(f.id)?.summary),
    [features, getSummaryCell]
  )

  const { lo, hi } = useMemo(
    () => computePlotDomain(filterMin, filterMax, summaries),
    [filterMin, filterMax, summaries]
  )

  const plotLeft = PAD_LEFT
  const plotTop = PAD_TOP
  const plotWidth = Math.max(COL_W * features.length, COL_W)
  const chartW = plotLeft + plotWidth + PAD_RIGHT
  const chartH = plotTop + PLOT_H + PAD_BOTTOM
  const plotRight = plotLeft + plotWidth

  const hasMatrixLine =
    matrixMin != null &&
    matrixMax != null &&
    Number.isFinite(matrixMin) &&
    Number.isFinite(matrixMax)
  const hasFilterMin = filterMin != null && Number.isFinite(filterMin)
  const hasFilterMax = filterMax != null && Number.isFinite(filterMax)

  const matrixMinLine = hasMatrixLine
    ? thresholdLineY(matrixMin!, lo, hi, plotTop, PLOT_H)
    : null
  const matrixMaxLine = hasMatrixLine
    ? thresholdLineY(matrixMax!, lo, hi, plotTop, PLOT_H)
    : null
  const filterMinLine = hasFilterMin
    ? thresholdLineY(filterMin!, lo, hi, plotTop, PLOT_H)
    : null
  const filterMaxLine = hasFilterMax
    ? thresholdLineY(filterMax!, lo, hi, plotTop, PLOT_H)
    : null

  const yTicks = [lo, (lo + hi) / 2, hi]

  return (
    <div className="px-3 py-3">
      <ThresholdLegend
        matrixMin={matrixMin}
        matrixMax={matrixMax}
        filterMin={filterMin}
        filterMax={filterMax}
        unit={unit}
      />
      <div className="min-w-0 overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="text-foreground"
          style={{ width: Math.max(chartW, 320), height: 'auto', minHeight: chartH }}
          role="img"
          aria-label="Shared vertical box plots for displayed features"
        >
          {[0.25, 0.5, 0.75].map((frac) => {
            const y = plotTop + frac * PLOT_H
            return (
              <line
                key={frac}
                x1={plotLeft}
                y1={y}
                x2={plotRight}
                y2={y}
                className="stroke-border/40"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            )
          })}

          {matrixMinLine && (
            <g>
              <line
                x1={plotLeft}
                y1={matrixMinLine.y}
                x2={plotRight}
                y2={matrixMinLine.y}
                className="stroke-primary/60"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              {matrixMinLine.offScale === 'below' && (
                <text
                  x={plotRight + 4}
                  y={matrixMinLine.y + 3}
                  className="fill-primary/80 text-[8px]"
                >
                  catalog min {formatHeatmapValue(matrixMin!)}
                </text>
              )}
            </g>
          )}
          {matrixMaxLine && (
            <g>
              <line
                x1={plotLeft}
                y1={matrixMaxLine.y}
                x2={plotRight}
                y2={matrixMaxLine.y}
                className="stroke-primary/60"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              {matrixMaxLine.offScale === 'above' && (
                <text
                  x={plotRight + 4}
                  y={matrixMaxLine.y + 3}
                  className="fill-primary/80 text-[8px]"
                >
                  catalog max {formatHeatmapValue(matrixMax!)}
                </text>
              )}
            </g>
          )}
          {filterMinLine && (
            <line
              x1={plotLeft}
              y1={filterMinLine.y}
              x2={plotRight}
              y2={filterMinLine.y}
              className="stroke-amber-600"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          )}
          {filterMaxLine && (
            <line
              x1={plotLeft}
              y1={filterMaxLine.y}
              x2={plotRight}
              y2={filterMaxLine.y}
              className="stroke-amber-600"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          )}

          <rect
            x={plotLeft}
            y={plotTop}
            width={plotWidth}
            height={PLOT_H}
            fill="transparent"
            className="stroke-border/50"
            strokeWidth={1}
          />

          {yTicks.map((tick) => {
            const y = scaleY(tick, lo, hi, plotTop, PLOT_H)
            return (
              <text
                key={tick}
                x={plotLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[9px] tabular-nums"
              >
                {formatHeatmapValue(tick)}
              </text>
            )
          })}

          {features.map((feature, i) => {
            const cx = plotLeft + COL_W * i + COL_W / 2
            const colX = plotLeft + COL_W * i
            const summary = getSummaryCell(feature.id)?.summary
            const label = featureDisplayLabel(feature)
            const isActive = activeFeatureId === feature.id
            const canOpen = Boolean(summary)

            return (
              <g key={feature.id}>
                {summary ? (
                  <g pointerEvents="none">
                    <VerticalBoxPlot
                      summary={summary}
                      cx={cx}
                      lo={lo}
                      hi={hi}
                      plotTop={plotTop}
                      plotHeight={PLOT_H}
                    />
                  </g>
                ) : summariesLoading ? (
                  <rect
                    x={cx - 8}
                    y={plotTop + PLOT_H * 0.35}
                    width={16}
                    height={PLOT_H * 0.3}
                    rx={4}
                    className="animate-pulse fill-muted"
                  />
                ) : null}
                {canOpen && (
                  <foreignObject
                    x={colX}
                    y={plotTop}
                    width={COL_W}
                    height={PLOT_H}
                    className="overflow-visible"
                  >
                    <div className="h-full w-full">
                      <button
                        type="button"
                        title={`${label} · cohort summary`}
                        aria-label={`Open expression summary for ${label}`}
                        aria-pressed={isActive}
                        className={`h-full w-full cursor-pointer rounded-md border-0 bg-transparent transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isActive ? 'bg-primary/15 ring-2 ring-primary/40' : ''
                        }`}
                        onClick={() => onBoxClick(feature.id)}
                      />
                    </div>
                  </foreignObject>
                )}
              </g>
            )
          })}
        </svg>

        <div
          className="flex shrink-0"
          style={{
            width: Math.max(chartW, 320),
            paddingLeft: plotLeft,
            paddingRight: PAD_RIGHT,
          }}
        >
          {features.map((feature) => {
            const summary = getSummaryCell(feature.id)?.summary
            const isActive = activeFeatureId === feature.id
            const canOpen = Boolean(summary)
            return (
              <div
                key={feature.id}
                className="flex shrink-0 flex-col items-center gap-0.5 px-0.5 text-center"
                style={{ width: COL_W }}
              >
                <Popover.Trigger
                  handle={popoverHandle}
                  id={canOpen ? featureRowTriggerId(feature.id) : undefined}
                  type="button"
                  disabled={!canOpen}
                  aria-pressed={isActive}
                  className={`max-w-full truncate rounded px-0.5 text-[10px] font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:no-underline disabled:opacity-60 ${
                    isActive ? 'bg-primary/15 ring-2 ring-primary/40' : ''
                  }`}
                  title={featureDisplayLabel(feature)}
                  onClick={() => onFeatureRowClick(feature.id)}
                >
                  {featureDisplayLabel(feature)}
                </Popover.Trigger>
                {summary?.minBiosampleId && (
                  <div className="flex max-w-full flex-col gap-0.5 text-[8px] leading-tight text-muted-foreground">
                    <EntityRecordLink
                      kind="biosample"
                      id={summary.minBiosampleId}
                      className="truncate hover:text-foreground"
                      title="Min biosample"
                    >
                      min
                    </EntityRecordLink>
                    {summary.maxBiosampleId &&
                      summary.maxBiosampleId !== summary.minBiosampleId && (
                        <EntityRecordLink
                          kind="biosample"
                          id={summary.maxBiosampleId}
                          className="truncate hover:text-foreground"
                          title="Max biosample"
                        >
                          max
                        </EntityRecordLink>
                      )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="mt-1 pl-[52px] text-[10px] text-muted-foreground">
        Y axis: cohort range for displayed genes
        {unit ? ` (${unit})` : ''}. Matrix catalog bounds shown as dashed lines
        {matrixMaxLine?.offScale === 'above' || matrixMinLine?.offScale === 'below'
          ? ' (pinned to chart edge when outside cohort range)'
          : ''}
        .
      </p>
    </div>
  )
}
