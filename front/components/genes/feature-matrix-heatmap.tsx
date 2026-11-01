'use client'

import { Popover } from '@base-ui/react/popover'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FeatureHeatmapPopoverContent,
  type HeatmapPopoverInspect,
} from '@/components/genes/feature-heatmap-popover-content'
import { MatrixUnitToggle } from '@/components/genes/matrix-unit-toggle'
import { useFeatureExpressionGrid } from '@/hooks/use-feature-expression-grid'
import { resolveUnitBucket, useMatricesByIds } from '@/hooks/use-matrices-by-ids'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import { featureDisplayLabel } from '@/lib/gene-lens'
import { COLOR_MISSING, COLOR_TEXT_DARK } from '@/components/heatmap-colors'
import { formatHeatmapValue, heatFill, heatTextColor } from '@/lib/heatmap-expression'

type FeatureMatrixHeatmapProps = {
  features: Feature[]
  focusMatrix?: string | null
  selectedFeatureId: string | null
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  unitKey: string | null
  onUnitKeyChange: (key: string) => void
}


function shortMatrixLabel(id: string): string {
  if (id.length <= 14) return id
  const parts = id.split(/[/:]/)
  const tail = parts[parts.length - 1]
  return tail.length <= 14 ? tail : `${tail.slice(0, 12)}…`
}

function triggerId(inspect: HeatmapPopoverInspect): string {
  if (inspect.kind === 'matrix-header') return `hdr:${inspect.matrixId}`
  if (inspect.kind === 'matrix-cell') return `cell:${inspect.featureId}:${inspect.matrixId}`
  return `row:${inspect.featureId}`
}

export function FeatureMatrixHeatmap({
  features,
  focusMatrix,
  selectedFeatureId,
  activeFilters,
  onAddFilter,
  unitKey,
  onUnitKeyChange,
}: FeatureMatrixHeatmapProps) {
  const popoverHandle = useMemo(() => Popover.createHandle(), [])
  const { pendingCount: expressionPending, error, matrixIds, getCell } =
    useFeatureExpressionGrid(features)
  const {
    matrices,
    buckets,
    pendingCount: matricesPending,
    error: matricesError,
  } = useMatricesByIds(matrixIds)
  const dataPending = expressionPending + matricesPending > 0
  const [inspect, setInspect] = useState<HeatmapPopoverInspect | null>(null)

  const matrixById = useMemo(
    () => new Map(matrices.map((m) => [m.matrixId ?? '', m])),
    [matrices]
  )
  const featureById = useMemo(
    () => new Map(features.map((f) => [f.id, f])),
    [features]
  )
  const featureKey = useMemo(
    () => features.map((f) => f.id).join('|'),
    [features]
  )

  const activeBucket = useMemo(
    () => resolveUnitBucket(buckets, unitKey),
    [buckets, unitKey]
  )

  const columns = useMemo(() => {
    const ids =
      activeBucket?.matrices
        .map((m) => m.matrixId)
        .filter((id): id is string => Boolean(id)) ?? []
    const sorted = [...ids].sort((a, b) => a.localeCompare(b))
    if (focusMatrix) return sorted.filter((id) => id === focusMatrix)
    return sorted
  }, [activeBucket, focusMatrix])

  const columnKey = columns.join('|')
  const scaleBoundsRef = useRef<{ min: number; max: number } | null>(null)

  useEffect(() => {
    scaleBoundsRef.current = null
  }, [featureKey, columnKey])

  const { scaleMin, scaleMax } = useMemo(() => {
    const values: number[] = []
    for (const feature of features) {
      for (const matrixId of columns) {
        const median = getCell(feature.id, matrixId)?.median
        if (median != null && Number.isFinite(median)) values.push(median)
      }
    }
    if (!values.length) {
      const b = scaleBoundsRef.current
      return b
        ? { scaleMin: b.min, scaleMax: b.max }
        : { scaleMin: 0, scaleMax: 1 }
    }
    const nextMin = Math.min(...values)
    const nextMax = Math.max(...values)
    const prev = scaleBoundsRef.current
    const merged = prev
      ? { min: Math.min(prev.min, nextMin), max: Math.max(prev.max, nextMax) }
      : { min: nextMin, max: nextMax }
    scaleBoundsRef.current = merged
    return { scaleMin: merged.min, scaleMax: merged.max }
  }, [features, columns, getCell, featureKey, columnKey])

  function openInspect(next: HeatmapPopoverInspect) {
    setInspect(next)
    queueMicrotask(() => popoverHandle.open(triggerId(next)))
  }

  const popoverFeature =
    inspect && inspect.kind !== 'matrix-header'
      ? featureById.get(inspect.featureId)
      : undefined
  const popoverCell =
    inspect?.kind === 'matrix-cell'
      ? getCell(inspect.featureId, inspect.matrixId)
      : undefined

  if (!features.length) return null

  return (
    <div className="relative space-y-3">
      <Popover.Root
        handle={popoverHandle}
        onOpenChange={(open) => {
          if (!open) setInspect(null)
        }}
      >
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} align="start" className="z-[200]">
            <Popover.Popup className="z-[200] w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
              {inspect && (
                <FeatureHeatmapPopoverContent
                  inspect={inspect}
                  feature={popoverFeature}
                  matrix={
                    inspect.kind === 'matrix-header'
                      ? matrixById.get(inspect.matrixId)
                      : inspect.kind === 'matrix-cell'
                        ? matrixById.get(inspect.matrixId)
                        : undefined
                  }
                  median={popoverCell?.median}
                  summary={popoverCell?.summary}
                  activeFilters={activeFilters}
                  onAddFilter={onAddFilter}
                  matrixContextFeature={
                    inspect.kind === 'matrix-header'
                      ? (selectedFeatureId
                          ? featureById.get(selectedFeatureId)
                          : features.length === 1
                            ? features[0]
                            : null)
                      : null
                  }
                  onNavigate={() => {
                    setInspect(null)
                    popoverHandle.close()
                  }}
                />
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <div className="flex flex-wrap items-center gap-2">
        <MatrixUnitToggle
          buckets={buckets}
          activeKey={activeBucket?.key ?? null}
          onChange={onUnitKeyChange}
        />
        {dataPending && (
          <span className="text-[11px] text-muted-foreground" aria-live="polite">
            Updating values…
          </span>
        )}
      </div>
      {(error || matricesError) && (
        <p className="text-xs text-destructive">{error || matricesError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-muted/20">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-[30] min-w-[9rem] border-b border-r border-border bg-muted px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Feature
              </th>
              {columns.map((matrixId) => (
                <th
                  key={matrixId}
                  className="sticky top-0 z-[20] border-b border-border bg-muted px-0.5 py-1 text-center"
                >
                  <Popover.Trigger
                    handle={popoverHandle}
                    id={triggerId({ kind: 'matrix-header', matrixId })}
                    type="button"
                    title={matrixId}
                    className="w-full max-w-[4.25rem] rounded-md px-1 py-1.5 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    onClick={() => openInspect({ kind: 'matrix-header', matrixId })}
                  >
                    <span className="block truncate">{shortMatrixLabel(matrixId)}</span>
                  </Popover.Trigger>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => {
              const rowSelected = feature.id === selectedFeatureId
              return (
                <tr key={feature.id} className="group/row">
                  <th
                    scope="row"
                    className={`sticky left-0 z-[25] border-r border-border px-1 py-0.5 text-left font-normal ${
                      rowSelected
                        ? 'bg-[var(--scope-genomicFeature-bg)]'
                        : 'bg-card group-hover/row:bg-muted/30'
                    }`}
                  >
                    <Popover.Trigger
                      handle={popoverHandle}
                      id={triggerId({ kind: 'feature-row', featureId: feature.id })}
                      type="button"
                      className="w-full max-w-[10rem] truncate rounded-md px-2 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 hover:underline"
                      onClick={() =>
                        openInspect({ kind: 'feature-row', featureId: feature.id })
                      }
                    >
                      {featureDisplayLabel(feature)}
                    </Popover.Trigger>
                  </th>
                  {columns.map((matrixId) => {
                    const cell = getCell(feature.id, matrixId)
                    const value = cell?.median
                    const hasValue = value != null && Number.isFinite(value)
                    const bg = hasValue
                      ? heatFill(value, scaleMin, scaleMax)
                      : COLOR_MISSING
                    const color = hasValue
                      ? heatTextColor(value, scaleMin, scaleMax)
                      : COLOR_TEXT_DARK

                    const cellClass =
                      'flex h-10 w-full min-w-[3rem] items-center justify-center rounded-md text-xs tabular-nums'

                    return (
                      <td key={matrixId} className="border-b border-border/60 p-0.5">
                        {hasValue ? (
                          <Popover.Trigger
                            handle={popoverHandle}
                            id={triggerId({
                              kind: 'matrix-cell',
                              featureId: feature.id,
                              matrixId,
                            })}
                            type="button"
                            title={`${featureDisplayLabel(feature)} · ${formatHeatmapValue(value!)}`}
                            className={`${cellClass} ring-offset-background transition-[background-color,color,transform,box-shadow] duration-300 hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                            style={{ backgroundColor: bg, color }}
                            onClick={() =>
                              openInspect({
                                kind: 'matrix-cell',
                                featureId: feature.id,
                                matrixId,
                              })
                            }
                          >
                            {formatHeatmapValue(value)}
                          </Popover.Trigger>
                        ) : (
                          <span
                            className={`${cellClass} cursor-default text-muted-foreground/70`}
                            style={{ backgroundColor: bg, color }}
                            aria-hidden
                          >
                            —
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!dataPending && columns.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No matrices in this unit view
          {focusMatrix ? ' (check matrix scope)' : ''}.
        </p>
      )}
    </div>
  )
}
