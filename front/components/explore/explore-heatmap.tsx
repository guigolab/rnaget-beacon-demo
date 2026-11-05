'use client'

import { Popover } from '@base-ui/react/popover'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExploreTissueCellPopover } from '@/components/explore/explore-tissue-cell-popover'
import { ExploreTissueColumnPopover } from '@/components/explore/explore-tissue-column-popover'
import { FeatureRowPopoverContent } from '@/components/genes/feature-row-popover-content'
import { HeatmapMatrixCellLoading } from '@/components/heatmap-matrix-cell'
import { BandHeatmapLegend } from '@/components/shared/band-heatmap-legend'
import type { UiFilter } from '@/lib/beacon'
import { isAbortError } from '@/lib/beacon/client'
import type { Feature } from '@/lib/beacon/types'
import {
  bandsForFeature,
  mergeTissueBandMaps,
  probeExploreTissueBands,
  tissueBandPairKey,
  type FeatureTissueBandMap,
} from '@/lib/explore-tissue-bands'
import {
  partitionExploreBiosampleFilters,
  resolveExploreTissueColumns,
} from '@/lib/explore-tissue-columns'
import { tissueOntologyIdsFromBiosampleFilters } from '@/lib/explore-lens'
import { featureDisplayLabel } from '@/lib/gene-lens'
import {
  HEATMAP_CELL_CLASS,
  HEATMAP_COL_FALLBACK_PX,
  HEATMAP_FEATURE_COL_CLASS,
  heatmapColumnWindow,
} from '@/lib/heatmap-table'
import {
  exploreTissueColumnUniverse,
  sortFeaturesByTissueBand,
  tissueBandFill,
  tissueBandFromInfo,
  tissueBandLabel,
  tissueBandShortLabel,
  tissueBandTextColor,
  type TissueBand,
  type TissueColumn,
} from '@/lib/tissue-levels'
import type { FilteringTerm } from '@/lib/beacon/types'

type ExploreHeatmapProps = {
  features: Feature[]
  terms: FilteringTerm[]
  biosampleFilters: UiFilter[]
  featureFilters: UiFilter[]
  selectedFeatureId: string | null
  /** When set (e.g. single biosample tissue), sort/focus that column. */
  seedFocusOntologyId?: string | null
  onAddFeatureFilter: (filter: UiFilter) => void
}

type Inspect =
  | { kind: 'feature-row'; featureId: string }
  | { kind: 'column-header'; ontologyId: string }
  | { kind: 'cell'; featureId: string; ontologyId: string }

function triggerId(inspect: Inspect): string {
  if (inspect.kind === 'column-header') return `hdr:${inspect.ontologyId}`
  if (inspect.kind === 'cell') {
    return `cell:${inspect.featureId}:${inspect.ontologyId}`
  }
  return `row:${inspect.featureId}`
}

function ColumnHeaderButton({
  column,
  focused,
  popoverHandle,
  onOpen,
  busy = false,
}: {
  column: TissueColumn
  focused: boolean
  popoverHandle: ReturnType<typeof Popover.createHandle>
  onOpen: () => void
  /** Subtle pulse while columns refine or this column's bands are still loading. */
  busy?: boolean
}) {
  return (
    <Popover.Trigger
      handle={popoverHandle}
      id={triggerId({ kind: 'column-header', ontologyId: column.ontologyId })}
      type="button"
      title={
        column.nBiosamples != null
          ? `${column.label} · n=${column.nBiosamples}`
          : column.label
      }
      className={`w-full rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors hover:bg-background hover:text-foreground ${
        focused
          ? 'bg-background text-foreground ring-1 ring-primary/40'
          : 'text-muted-foreground'
      } ${busy ? 'opacity-60' : ''}`}
      onClick={onOpen}
    >
      <span className={`block truncate ${busy ? 'animate-pulse' : ''}`}>
        {column.label}
      </span>
      {column.nBiosamples != null && (
        <span className="block truncate text-[9px] font-normal opacity-70">
          n={column.nBiosamples}
        </span>
      )}
    </Popover.Trigger>
  )
}

function SkeletonColumnHeader({ width }: { width: number }) {
  return (
    <th
      aria-hidden
      className="sticky top-0 z-[20] box-border border-b border-border bg-muted px-0.5 py-1 text-center"
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <span className="mx-auto block h-3 w-[70%] animate-pulse rounded-sm bg-muted-foreground/25" />
    </th>
  )
}

const SIZE_EPSILON_PX = 2
const SKELETON_COLUMN_COUNT = 7

export function ExploreHeatmap({
  features,
  terms,
  biosampleFilters,
  featureFilters,
  selectedFeatureId,
  seedFocusOntologyId = null,
  onAddFeatureFilter,
}: ExploreHeatmapProps) {
  const popoverHandle = useMemo(() => Popover.createHandle(), [])
  const [inspect, setInspect] = useState<Inspect | null>(null)
  const [viewBand, setViewBand] = useState<TissueBand | null>(null)
  const [focusOntologyId, setFocusOntologyId] = useState<string | null>(
    seedFocusOntologyId
  )

  useEffect(() => {
    if (seedFocusOntologyId) setFocusOntologyId(seedFocusOntologyId)
  }, [seedFocusOntologyId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportW, setViewportW] = useState(0)
  // Fixed column width — do not measure from layout (w-full stretch would inflate it).
  const colWidth = HEATMAP_COL_FALLBACK_PX

  const [columns, setColumns] = useState<TissueColumn[]>([])
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [columnsError, setColumnsError] = useState('')
  const [bandMap, setBandMap] = useState<FeatureTissueBandMap>(() => new Map())
  const [probedPairs, setProbedPairs] = useState<Set<string>>(() => new Set())
  const [bandsLoading, setBandsLoading] = useState(false)
  const [bandsError, setBandsError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const { constraintFilters } = partitionExploreBiosampleFilters(
      biosampleFilters
    )
    const sync = exploreTissueColumnUniverse(terms, biosampleFilters)

    // No constraint probes: apply sync narrow immediately.
    if (!constraintFilters.length) {
      setColumns(sync)
      setColumnsLoading(false)
      setColumnsError('')
      return () => controller.abort()
    }

    // Keep previous columns while counts refine. The first paint still uses
    // the catalog universe so band probes are not blocked on n= requests.
    setColumns((prev) => (prev.length ? prev : sync))
    setColumnsLoading(true)
    setColumnsError('')
    resolveExploreTissueColumns({
      terms,
      biosampleFilters,
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return
        setColumns(next)
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
        setColumnsError(
          err instanceof Error ? err.message : 'Failed to update tissue columns'
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setColumnsLoading(false)
      })
    return () => controller.abort()
  }, [terms, biosampleFilters])

  const columnById = useMemo(
    () => new Map(columns.map((c) => [c.ontologyId, c])),
    [columns]
  )
  const sortedFeatures = useMemo(() => {
    if (!focusOntologyId) return features
    return sortFeaturesByTissueBand(features, focusOntologyId, (feature) =>
      bandsForFeature(bandMap, feature.id)
    )
  }, [features, focusOntologyId, bandMap])
  const featureById = useMemo(
    () => new Map(sortedFeatures.map((f) => [f.id, f])),
    [sortedFeatures]
  )

  const { start, end, padLeft, padRight } = heatmapColumnWindow({
    columnCount: columns.length,
    scrollLeft,
    viewportW,
    colWidth,
    few: false,
  })
  const visibleColumns = columns.slice(start, end)
  const tableWidthPx = `calc(9rem + ${columns.length * colWidth}px)`
  const featureIdsKey = features.map((f) => f.id).join('|')
  const columnsKey = columns.map((c) => c.ontologyId).join('|')
  const visibleKey = visibleColumns.map((c) => c.ontologyId).join('|')
  const assumePresentOntologyIds = useMemo(
    () => tissueOntologyIdsFromBiosampleFilters(biosampleFilters),
    [biosampleFilters]
  )
  const assumePresentKey = assumePresentOntologyIds.join('|')
  const prevAssumePresentKeyRef = useRef(assumePresentKey)

  // Probe feature×column pairs that are on screen and not painted yet.
  // Load-more and scrolling back reuse probedPairs. A failed column stays on
  // the loading cell and does not clear columns already painted.
  useEffect(() => {
    const controller = new AbortController()
    const featureIds = new Set(features.map((f) => f.id).filter(Boolean))
    const columnIds = new Set(columns.map((c) => c.ontologyId).filter(Boolean))
    const prevAssume = prevAssumePresentKeyRef.current
    const assumePresentChanged = prevAssume !== assumePresentKey
    prevAssumePresentKeyRef.current = assumePresentKey
    const invalidateOids = new Set<string>()
    if (assumePresentChanged) {
      for (const oid of prevAssume.split('|')) {
        if (oid) invalidateOids.add(oid.toLowerCase())
      }
      for (const oid of assumePresentOntologyIds) {
        invalidateOids.add(oid.toLowerCase())
      }
    }
    const activePairs = new Set<string>()
    for (const key of probedPairs) {
      const sep = key.indexOf('\0')
      if (sep < 0) continue
      const fid = key.slice(0, sep)
      const oid = key.slice(sep + 1)
      if (invalidateOids.has(oid.toLowerCase())) continue
      if (featureIds.has(fid) && columnIds.has(oid)) activePairs.add(key)
    }
    let pairsChanged = activePairs.size !== probedPairs.size
    if (!pairsChanged) {
      for (const key of probedPairs) {
        if (!activePairs.has(key)) {
          pairsChanged = true
          break
        }
      }
    }
    if (pairsChanged || assumePresentChanged) setProbedPairs(activePairs)
    setBandMap((prev) => {
      let changed = false
      const next: FeatureTissueBandMap = new Map()
      for (const [fid, bands] of prev) {
        if (!featureIds.has(fid)) {
          changed = true
          continue
        }
        const kept: Record<string, number> = {}
        for (const [oid, value] of Object.entries(bands)) {
          if (invalidateOids.has(oid.toLowerCase())) {
            changed = true
            continue
          }
          if (columnIds.has(oid)) kept[oid] = value
          else changed = true
        }
        next.set(fid, kept)
      }
      if (next.size !== prev.size) changed = true
      return changed ? next : prev
    })

    const missing = features.some((feature) =>
      visibleColumns.some(
        (column) =>
          feature.id &&
          column.ontologyId &&
          !activePairs.has(tissueBandPairKey(feature.id, column.ontologyId))
      )
    )
    if (!features.length || !visibleColumns.length || !missing) {
      setBandsLoading(false)
      return () => controller.abort()
    }

    setBandsLoading(true)
    setBandsError('')
    probeExploreTissueBands({
      features,
      columns: visibleColumns,
      skipPairs: activePairs,
      assumePresentOntologyIds,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return
        setBandMap((prev) => mergeTissueBandMaps(prev, result.bands))
        if (!result.probedPairs.size) return
        setProbedPairs((prev) => {
          const next = new Set(prev)
          for (const key of result.probedPairs) next.add(key)
          return next
        })
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
        setBandsError(
          err instanceof Error ? err.message : 'Failed to update tissue bands'
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setBandsLoading(false)
      })
    return () => controller.abort()
    // featureIdsKey / columnsKey / visibleKey / assumePresentKey identify the
    // probe inputs. probedPairs is read from this render and must not
    // re-trigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional keys
  }, [featureIdsKey, columnsKey, visibleKey, assumePresentKey])

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
  }, [columns.length, sortedFeatures.length])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollLeft(el.scrollLeft)
  }, [])

  function openInspect(next: Inspect) {
    if (next.kind === 'column-header') {
      setFocusOntologyId(next.ontologyId)
    }
    setInspect(next)
    queueMicrotask(() => popoverHandle.open(triggerId(next)))
  }

  if (!features.length) return null

  const inspectFeature =
    inspect && inspect.kind !== 'column-header'
      ? featureById.get(inspect.featureId)
      : undefined
  const inspectColumn =
    inspect && inspect.kind !== 'feature-row'
      ? columnById.get(inspect.ontologyId)
      : undefined
  const inspectReady =
    inspect?.kind === 'cell'
      ? probedPairs.has(
          tissueBandPairKey(inspect.featureId, inspect.ontologyId)
        )
      : false
  const inspectBand =
    inspect?.kind === 'cell' && inspectFeature && inspectReady
      ? tissueBandFromInfo(
          bandsForFeature(bandMap, inspectFeature.id),
          inspect.ontologyId
        )
      : undefined

  const shellBusy = columnsLoading || bandsLoading
  const showColumnsSkeleton = columnsLoading && columns.length === 0
  const emptyColumnsMessage = biosampleFilters.some(
    (f) => f.kind === 'ontology' && /^UBERON:|^EFO:/i.test(f.id)
  )
    ? 'Current sample filters do not match any tissue/cell columns.'
    : terms.some(
          (t) =>
            (t.scopes?.includes('biosample') ?? false) &&
            /^UBERON:|^EFO:/i.test(t.id)
        )
      ? 'Current sample filters do not match any tissue/cell columns.'
      : 'No tissue/cell ontology terms in the filtering catalog yet.'

  const skeletonWidthPx = `calc(9rem + ${SKELETON_COLUMN_COUNT * colWidth}px)`

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
              {inspect?.kind === 'feature-row' && inspectFeature && (
                <FeatureRowPopoverContent
                  feature={inspectFeature}
                  activeFilters={featureFilters}
                  onAddFilter={onAddFeatureFilter}
                  onNavigate={() => {
                    setInspect(null)
                    popoverHandle.close()
                  }}
                />
              )}
              {inspect?.kind === 'column-header' && inspectColumn && (
                <ExploreTissueColumnPopover
                  column={inspectColumn}
                  onNavigate={() => {
                    setInspect(null)
                    popoverHandle.close()
                  }}
                />
              )}
              {inspect?.kind === 'cell' &&
                inspectFeature &&
                inspectColumn &&
                inspectBand != null && (
                  <ExploreTissueCellPopover
                    feature={inspectFeature}
                    column={inspectColumn}
                    band={inspectBand}
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

      <div
        className="rounded-lg border border-border bg-muted/20"
        aria-busy={shellBusy || undefined}
      >
        <div className="border-b border-border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <BandHeatmapLegend
              variant="tissue"
              viewBand={viewBand}
              onViewBandChange={setViewBand}
              className="min-w-0 flex-1"
            />
            {columnsLoading && (
              <span
                className="shrink-0 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                Updating columns…
              </span>
            )}
            {!columnsLoading && bandsLoading && (
              <span
                className="shrink-0 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                Updating bands…
              </span>
            )}
            {columnsError && (
              <span className="text-[11px] text-destructive">{columnsError}</span>
            )}
            {bandsError && (
              <span className="text-[11px] text-destructive">{bandsError}</span>
            )}
          </div>
        </div>
        {showColumnsSkeleton ? (
          <div className="overflow-x-auto" aria-busy>
            <table
              className="table-fixed border-collapse text-xs"
              style={{ width: skeletonWidthPx, minWidth: skeletonWidthPx }}
            >
              <thead>
                <tr>
                  <th
                    className={`sticky left-0 top-0 z-[30] border-b border-r border-border bg-muted px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${HEATMAP_FEATURE_COL_CLASS}`}
                  >
                    Feature
                  </th>
                  {Array.from({ length: SKELETON_COLUMN_COUNT }, (_, i) => (
                    <SkeletonColumnHeader key={i} width={colWidth} />
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
                        } ${HEATMAP_FEATURE_COL_CLASS}`}
                      >
                        <span className="block max-w-[10rem] truncate px-2 py-2 text-left text-sm font-medium text-foreground">
                          {featureDisplayLabel(feature)}
                        </span>
                      </th>
                      {Array.from({ length: SKELETON_COLUMN_COUNT }, (_, i) => (
                        <td
                          key={i}
                          className="box-border border-b border-border/60 p-0.5"
                          style={{
                            width: colWidth,
                            minWidth: colWidth,
                            maxWidth: colWidth,
                          }}
                        >
                          <HeatmapMatrixCellLoading ariaLabel="Loading tissue band" />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : columns.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {emptyColumnsMessage}
          </p>
        ) : (
          <div ref={scrollRef} className="overflow-x-auto" onScroll={onScroll}>
            <table
              className="table-fixed border-collapse text-xs"
              style={{ width: tableWidthPx, minWidth: tableWidthPx }}
            >
              <thead>
                <tr>
                  <th
                    className={`sticky left-0 top-0 z-[30] border-b border-r border-border bg-muted px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${HEATMAP_FEATURE_COL_CLASS}`}
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
                  {visibleColumns.map((col) => {
                    const headerBusy =
                      columnsLoading ||
                      (bandsLoading &&
                        features.some(
                          (feature) =>
                            Boolean(feature.id) &&
                            !probedPairs.has(
                              tissueBandPairKey(feature.id, col.ontologyId)
                            )
                        ))
                    return (
                      <th
                        key={col.ontologyId}
                        className="sticky top-0 z-[20] box-border border-b border-border bg-muted px-0.5 py-1 text-center"
                        style={{
                          width: colWidth,
                          minWidth: colWidth,
                          maxWidth: colWidth,
                        }}
                      >
                        <ColumnHeaderButton
                          column={col}
                          focused={col.ontologyId === focusOntologyId}
                          popoverHandle={popoverHandle}
                          busy={headerBusy}
                          onOpen={() =>
                            openInspect({
                              kind: 'column-header',
                              ontologyId: col.ontologyId,
                            })
                          }
                        />
                      </th>
                    )
                  })}
                  {padRight > 0 && (
                    <th
                      aria-hidden
                      className="border-0 p-0"
                      style={{
                        width: padRight,
                        minWidth: padRight,
                        maxWidth: padRight,
                      }}
                    />
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedFeatures.map((feature) => {
                  const rowSelected = feature.id === selectedFeatureId
                  return (
                    <tr key={feature.id} className="group/row">
                      <th
                        scope="row"
                        className={`sticky left-0 z-[25] border-r border-border px-1 py-0.5 text-left font-normal ${
                          rowSelected
                            ? 'bg-[var(--scope-genomicFeature-bg)]'
                            : 'bg-card group-hover/row:bg-muted/30'
                        } ${HEATMAP_FEATURE_COL_CLASS}`}
                      >
                        <Popover.Trigger
                          handle={popoverHandle}
                          id={triggerId({
                            kind: 'feature-row',
                            featureId: feature.id,
                          })}
                          type="button"
                          className="w-full max-w-[10rem] truncate rounded-md px-2 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 hover:underline"
                          onClick={() =>
                            openInspect({
                              kind: 'feature-row',
                              featureId: feature.id,
                            })
                          }
                        >
                          {featureDisplayLabel(feature)}
                        </Popover.Trigger>
                      </th>
                      {padLeft > 0 && (
                        <td
                          aria-hidden
                          className="border-0 p-0"
                          style={{
                            width: padLeft,
                            minWidth: padLeft,
                            maxWidth: padLeft,
                          }}
                        />
                      )}
                      {visibleColumns.map((col) => {
                        const ready = probedPairs.has(
                          tissueBandPairKey(feature.id, col.ontologyId)
                        )
                        if (!ready) {
                          return (
                            <td
                              key={col.ontologyId}
                              className="box-border border-b border-border/60 p-0.5"
                              style={{
                                width: colWidth,
                                minWidth: colWidth,
                                maxWidth: colWidth,
                              }}
                            >
                              <HeatmapMatrixCellLoading ariaLabel="Loading tissue band" />
                            </td>
                          )
                        }
                        const band = tissueBandFromInfo(
                          bandsForFeature(bandMap, feature.id),
                          col.ontologyId
                        )
                        const bg = tissueBandFill(band)
                        const color = tissueBandTextColor(band)
                        const title = `${featureDisplayLabel(feature)} · ${col.label} · ${tissueBandLabel(band)}`
                        const cellStyle = {
                          backgroundColor: bg,
                          color,
                          backgroundImage:
                            band === 'none'
                              ? 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)'
                              : undefined,
                        }
                        return (
                          <td
                            key={col.ontologyId}
                            className="box-border border-b border-border/60 p-0.5"
                            style={{
                              width: colWidth,
                              minWidth: colWidth,
                              maxWidth: colWidth,
                            }}
                          >
                            {band === 'none' ? (
                              <div
                                title={title}
                                aria-label={title}
                                className={`${HEATMAP_CELL_CLASS} cursor-default`}
                                style={cellStyle}
                              >
                                {tissueBandShortLabel(band)}
                              </div>
                            ) : (
                              <Popover.Trigger
                                handle={popoverHandle}
                                id={triggerId({
                                  kind: 'cell',
                                  featureId: feature.id,
                                  ontologyId: col.ontologyId,
                                })}
                                type="button"
                                title={title}
                                className={`${HEATMAP_CELL_CLASS} relative ring-offset-background transition-[background-color,color,transform,box-shadow] duration-300 hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                                style={cellStyle}
                                onClick={() =>
                                  openInspect({
                                    kind: 'cell',
                                    featureId: feature.id,
                                    ontologyId: col.ontologyId,
                                  })
                                }
                              >
                                {tissueBandShortLabel(band)}
                              </Popover.Trigger>
                            )}
                          </td>
                        )
                      })}
                      {padRight > 0 && (
                        <td
                          aria-hidden
                          className="border-0 p-0"
                          style={{
                            width: padRight,
                            minWidth: padRight,
                            maxWidth: padRight,
                          }}
                        />
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
