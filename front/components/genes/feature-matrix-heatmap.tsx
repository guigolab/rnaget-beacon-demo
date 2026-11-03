'use client'

import { Popover } from '@base-ui/react/popover'
import { useMemo, useState } from 'react'
import {
  FeatureHeatmapPopoverContent,
  type HeatmapPopoverInspect,
} from '@/components/genes/feature-heatmap-popover-content'
import { BandHeatmapLegend } from '@/components/shared/band-heatmap-legend'
import { useFeatureBandGrid } from '@/hooks/use-feature-band-grid'
import { useMatricesByIds } from '@/hooks/use-matrices-by-ids'
import type { UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import {
  bandFill,
  bandLabel,
  bandShortLabel,
  bandTextColor,
} from '@/lib/expression-band'
import { featureDisplayLabel } from '@/lib/gene-lens'
import {
  HEATMAP_CELL_CLASS,
  HEATMAP_FEATURE_COL_CLASS,
  HEATMAP_FEW_BIOSAMPLE_MAX,
} from '@/lib/heatmap-table'
import { matrixUnitLabel } from '@/lib/comparability'
import { COLOR_MISSING, COLOR_TEXT_DARK } from '@/components/heatmap-colors'

type FeatureMatrixHeatmapProps = {
  features: Feature[]
  focusMatrix?: string | null
  selectedFeatureId: string | null
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
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
}: FeatureMatrixHeatmapProps) {
  const popoverHandle = useMemo(() => Popover.createHandle(), [])
  const { pendingCount: bandPending, error, matrixIds, getCell } =
    useFeatureBandGrid(features, focusMatrix)
  const {
    matrices,
    pendingCount: matricesPending,
    error: matricesError,
  } = useMatricesByIds(matrixIds)
  const dataPending = bandPending + matricesPending > 0
  const [inspect, setInspect] = useState<HeatmapPopoverInspect | null>(null)

  const matrixById = useMemo(
    () => new Map(matrices.map((m) => [m.matrixId ?? '', m])),
    [matrices]
  )
  const featureById = useMemo(
    () => new Map(features.map((f) => [f.id, f])),
    [features]
  )

  const columns = matrixIds

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

  const fewColumnLayout =
    columns.length > 0 && columns.length <= HEATMAP_FEW_BIOSAMPLE_MAX

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
                  band={popoverCell?.band}
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

      {(error || matricesError) && (
        <p className="text-xs text-destructive">{error || matricesError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-muted/20">
        <div className="border-b border-border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <BandHeatmapLegend className="min-w-0 flex-1" />
            {dataPending && (
              <span
                className="shrink-0 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                Updating bands…
              </span>
            )}
          </div>
        </div>
        <table
          className={
            fewColumnLayout
              ? 'w-full table-fixed border-collapse text-xs'
              : 'w-full min-w-max border-collapse text-xs'
          }
        >
          {fewColumnLayout && (
            <colgroup>
              <col style={{ width: '9rem' }} />
              {columns.map((matrixId) => (
                <col key={matrixId} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              <th
                className={`sticky left-0 top-0 z-[30] border-b border-r border-border bg-muted px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
                  fewColumnLayout ? HEATMAP_FEATURE_COL_CLASS : 'min-w-[9rem]'
                }`}
              >
                Feature
              </th>
              {columns.map((matrixId) => {
                const matrix = matrixById.get(matrixId)
                const unitTip = matrix ? matrixUnitLabel(matrix) : undefined
                return (
                  <th
                    key={matrixId}
                    className="sticky top-0 z-[20] border-b border-border bg-muted px-0.5 py-1 text-center"
                  >
                    <Popover.Trigger
                      handle={popoverHandle}
                      id={triggerId({ kind: 'matrix-header', matrixId })}
                      type="button"
                      title={unitTip ? `${matrixId} · ${unitTip}` : matrixId}
                      className={`w-full rounded-md px-1 py-1.5 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground ${
                        fewColumnLayout ? '' : 'max-w-[4.25rem]'
                      }`}
                      onClick={() => openInspect({ kind: 'matrix-header', matrixId })}
                    >
                      <span className="block truncate">{shortMatrixLabel(matrixId)}</span>
                    </Popover.Trigger>
                  </th>
                )
              })}
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
                    } ${fewColumnLayout ? HEATMAP_FEATURE_COL_CLASS : ''}`}
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
                    const band = cell?.band
                    const ready = band != null
                    const bg = ready ? bandFill(band) : COLOR_MISSING
                    const color = ready ? bandTextColor(band) : COLOR_TEXT_DARK

                    return (
                      <td key={matrixId} className="border-b border-border/60 p-0.5">
                        {ready ? (
                          <Popover.Trigger
                            handle={popoverHandle}
                            id={triggerId({
                              kind: 'matrix-cell',
                              featureId: feature.id,
                              matrixId,
                            })}
                            type="button"
                            title={`${featureDisplayLabel(feature)} · ${bandLabel(band)}`}
                            className={`${HEATMAP_CELL_CLASS} ring-offset-background transition-[background-color,color,transform,box-shadow] duration-300 hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                            style={{ backgroundColor: bg, color }}
                            onClick={() =>
                              openInspect({
                                kind: 'matrix-cell',
                                featureId: feature.id,
                                matrixId,
                              })
                            }
                          >
                            {bandShortLabel(band)}
                          </Popover.Trigger>
                        ) : (
                          <span
                            className={`${HEATMAP_CELL_CLASS} cursor-default text-muted-foreground/70`}
                            style={{ backgroundColor: bg, color }}
                            aria-hidden
                          >
                            …
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
          No matrices for these features
          {focusMatrix ? ' (check matrix scope)' : ''}.
        </p>
      )}
    </div>
  )
}
