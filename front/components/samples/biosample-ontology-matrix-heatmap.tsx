'use client'

import { Popover } from '@base-ui/react/popover'
import { useMemo, useState } from 'react'
import { COLOR_MISSING, COLOR_TEXT_DARK } from '@/components/heatmap-colors'
import {
  BiosampleOntologyHeatmapPopover,
  type OntologyHeatmapInspect,
} from '@/components/samples/biosample-ontology-heatmap-popover'
import { useBiosampleOntologyGrid } from '@/hooks/use-biosample-ontology-grid'
import { useMatricesByIds } from '@/hooks/use-matrices-by-ids'
import type { UiFilter } from '@/lib/beacon'
import { matrixUnitLabel } from '@/lib/comparability'
import { heatFill, heatTextColor } from '@/lib/heatmap-expression'
import {
  HEATMAP_CELL_CLASS,
  HEATMAP_FEATURE_COL_CLASS,
  HEATMAP_FEW_BIOSAMPLE_MAX,
} from '@/lib/heatmap-table'

type BiosampleOntologyMatrixHeatmapProps = {
  focusMatrix?: string | null
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  onBrowseRecords: (filter: UiFilter, matrixId: string) => void
}

function shortMatrixLabel(id: string): string {
  if (id.length <= 14) return id
  const parts = id.split(/[/:]/)
  const tail = parts[parts.length - 1]
  return tail.length <= 14 ? tail : `${tail.slice(0, 12)}…`
}

function triggerId(inspect: OntologyHeatmapInspect): string {
  if (inspect.kind === 'matrix-header') return `hdr:${inspect.matrixId}`
  if (inspect.kind === 'matrix-cell') {
    return `cell:${inspect.ontologyId}:${inspect.matrixId}`
  }
  return `row:${inspect.ontologyId}`
}

function CountLegend({
  min,
  max,
  className = '',
}: {
  min: number
  max: number
  className?: string
}) {
  return (
    <ul
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}
      aria-label="Biosample count legend"
    >
      <li className="flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 shrink-0 rounded-sm border border-border/60"
          style={{
            backgroundColor: COLOR_MISSING,
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 1px, rgba(0,0,0,0.12) 1px, rgba(0,0,0,0.12) 2px)',
          }}
          aria-hidden
        />
        <span>Absent</span>
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 shrink-0 rounded-sm border border-border/60"
          style={{ backgroundColor: heatFill(min, min, max) }}
          aria-hidden
        />
        <span>Count {min.toLocaleString()}</span>
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 shrink-0 rounded-sm border border-border/60"
          style={{ backgroundColor: heatFill(max, min, max) }}
          aria-hidden
        />
        <span>Count {max.toLocaleString()}</span>
      </li>
    </ul>
  )
}

export function BiosampleOntologyMatrixHeatmap({
  focusMatrix,
  activeFilters,
  onAddFilter,
  onBrowseRecords,
}: BiosampleOntologyMatrixHeatmapProps) {
  const popoverHandle = useMemo(() => Popover.createHandle(), [])
  const {
    bootLoading,
    pendingCount,
    error,
    matrixIds,
    rows,
    getCell,
    countBounds,
  } = useBiosampleOntologyGrid({ focusMatrix, activeFilters })
  const {
    matrices,
    pendingCount: matricesPending,
    error: matricesError,
  } = useMatricesByIds(matrixIds)
  const dataPending = bootLoading || pendingCount + matricesPending > 0
  const [inspect, setInspect] = useState<OntologyHeatmapInspect | null>(null)

  const matrixById = useMemo(
    () => new Map(matrices.map((m) => [m.matrixId ?? '', m])),
    [matrices]
  )
  const rowById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows]
  )

  const columns = matrixIds
  const fewColumnLayout =
    columns.length > 0 && columns.length <= HEATMAP_FEW_BIOSAMPLE_MAX

  function openInspect(next: OntologyHeatmapInspect) {
    setInspect(next)
    queueMicrotask(() => popoverHandle.open(triggerId(next)))
  }

  const popoverRow =
    inspect && inspect.kind !== 'matrix-header'
      ? rowById.get(inspect.ontologyId)
      : undefined
  const popoverCell =
    inspect?.kind === 'matrix-cell'
      ? getCell(inspect.ontologyId, inspect.matrixId)
      : undefined

  if (bootLoading && !rows.length) {
    return (
      <div className="space-y-3" aria-busy>
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No tissue or cell ontologies found on matrix filtering terms
        {focusMatrix ? ' for this matrix scope' : ''}.
      </p>
    )
  }

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
                <BiosampleOntologyHeatmapPopover
                  inspect={inspect}
                  row={popoverRow}
                  matrix={
                    inspect.kind === 'matrix-header' ||
                    inspect.kind === 'matrix-cell'
                      ? matrixById.get(inspect.matrixId)
                      : undefined
                  }
                  cell={popoverCell}
                  onAddFilter={onAddFilter}
                  onBrowseRecords={onBrowseRecords}
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
            <CountLegend
              min={countBounds.min}
              max={countBounds.max}
              className="min-w-0 flex-1"
            />
            {dataPending && (
              <span
                className="shrink-0 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                Updating counts…
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
                Ontology
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
                      onClick={() =>
                        openInspect({ kind: 'matrix-header', matrixId })
                      }
                    >
                      <span className="block truncate">
                        {shortMatrixLabel(matrixId)}
                      </span>
                    </Popover.Trigger>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="group/row">
                <th
                  scope="row"
                  className={`sticky left-0 z-[25] border-r border-border bg-card px-1 py-0.5 text-left font-normal group-hover/row:bg-muted/30 ${
                    fewColumnLayout ? HEATMAP_FEATURE_COL_CLASS : ''
                  }`}
                >
                  <Popover.Trigger
                    handle={popoverHandle}
                    id={triggerId({ kind: 'ontology-row', ontologyId: row.id })}
                    type="button"
                    className="w-full max-w-[10rem] truncate rounded-md px-2 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 hover:underline"
                    onClick={() =>
                      openInspect({
                        kind: 'ontology-row',
                        ontologyId: row.id,
                      })
                    }
                  >
                    {row.label}
                  </Popover.Trigger>
                </th>
                {columns.map((matrixId) => {
                  const cell = getCell(row.id, matrixId)
                  const ready = cell != null && cell.state !== 'pending'
                  const absent = cell?.state === 'absent'
                  const present = cell?.state === 'present'
                  const count = cell?.count
                  let bg = COLOR_MISSING
                  let color = COLOR_TEXT_DARK
                  let label = '…'
                  if (absent) {
                    bg = COLOR_MISSING
                    color = COLOR_TEXT_DARK
                    label = '—'
                  } else if (present && count != null) {
                    bg = heatFill(count, countBounds.min, countBounds.max)
                    color = heatTextColor(
                      count,
                      countBounds.min,
                      countBounds.max
                    )
                    label = count.toLocaleString()
                    if (count >= 1000 && label.length > 5) {
                      label =
                        count >= 1_000_000
                          ? `${(count / 1_000_000).toFixed(1)}M`
                          : `${(count / 1000).toFixed(1)}k`
                    }
                  }

                  return (
                    <td key={matrixId} className="border-b border-border/60 p-0.5">
                      {ready ? (
                        <Popover.Trigger
                          handle={popoverHandle}
                          id={triggerId({
                            kind: 'matrix-cell',
                            ontologyId: row.id,
                            matrixId,
                          })}
                          type="button"
                          title={`${row.label} · ${matrixId} · ${
                            present ? `${count?.toLocaleString() ?? 0}` : 'absent'
                          }`}
                          className={`${HEATMAP_CELL_CLASS} ring-offset-background transition-[background-color,color,transform,box-shadow] duration-300 hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                          style={{
                            backgroundColor: bg,
                            color: present ? color : COLOR_TEXT_DARK,
                            backgroundImage: absent
                              ? 'repeating-linear-gradient(45deg, transparent, transparent 1px, rgba(0,0,0,0.08) 1px, rgba(0,0,0,0.08) 2px)'
                              : undefined,
                          }}
                          onClick={() =>
                            openInspect({
                              kind: 'matrix-cell',
                              ontologyId: row.id,
                              matrixId,
                            })
                          }
                        >
                          {label}
                        </Popover.Trigger>
                      ) : (
                        <span
                          className={`${HEATMAP_CELL_CLASS} cursor-default text-muted-foreground/70`}
                          style={{
                            backgroundColor: COLOR_MISSING,
                            color: COLOR_TEXT_DARK,
                          }}
                          aria-hidden
                        >
                          …
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!dataPending && columns.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No matrices available
          {focusMatrix ? ' (check matrix scope)' : ''}.
        </p>
      )}
    </div>
  )
}
