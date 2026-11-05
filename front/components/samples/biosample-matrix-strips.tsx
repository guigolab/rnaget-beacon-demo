'use client'

import { Popover } from '@base-ui/react/popover'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { MatrixPopoverDetails } from '@/components/genes/matrix-popover-details'
import { DetailHeaderIconLink } from '@/components/shared/detail/detail-header-icon-link'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { useMatricesByIds } from '@/hooks/use-matrices-by-ids'
import type { Matrix } from '@/lib/beacon'
import type { Biosample } from '@/lib/beacon/types'
import { matrixUnitLabel } from '@/lib/comparability'
import { stripsForBiosamplePage } from '@/lib/biosample-matrix-strips'
import {
  UNLINKED_BIOSAMPLE_STRIP_ID,
  biosampleDisplayLabel,
  biosampleMatrixHeatmapHref,
  biosampleMatrixStripHref,
  biosampleResultChipTerms,
} from '@/lib/sample-lens'

type BiosampleMatrixStripsProps = {
  samples: Biosample[]
  focusMatrix?: string | null
  selectedBiosampleId?: string | null
}

type StripInspect =
  | { kind: 'matrix-header'; matrixId: string }
  | { kind: 'biosample-row'; biosampleId: string; matrixId: string }

function shortMatrixLabel(id: string): string {
  if (id.length <= 18) return id
  const parts = id.split(/[/:]/)
  const tail = parts[parts.length - 1]
  return tail.length <= 18 ? tail : `${tail.slice(0, 16)}…`
}

function triggerId(inspect: StripInspect): string {
  if (inspect.kind === 'matrix-header') return `hdr:${inspect.matrixId}`
  return `row:${inspect.matrixId}:${inspect.biosampleId}`
}

function StripRowPopover({
  sample,
  matrixId,
  onNavigate,
}: {
  sample: Biosample
  matrixId: string
  onNavigate?: () => void
}) {
  const href =
    matrixId !== UNLINKED_BIOSAMPLE_STRIP_ID
      ? biosampleMatrixHeatmapHref(sample.id, matrixId)
      : null
  return (
    <div className="text-popover-foreground">
      <DetailSurfaceHeader
        density="popover"
        title={biosampleDisplayLabel(sample)}
        meta={sample.id}
        actions={
          href ? (
            <DetailHeaderIconLink
              href={href}
              label="Open in matrix"
              onClick={onNavigate}
            />
          ) : null
        }
      />
      <DetailScrollBody density="popover" className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {(sample.matrixIds?.length ?? 0).toLocaleString()} matrix
          {(sample.matrixIds?.length ?? 0) === 1 ? '' : 'es'}
        </p>
      </DetailScrollBody>
    </div>
  )
}

export function BiosampleMatrixStrips({
  samples,
  focusMatrix,
  selectedBiosampleId,
}: BiosampleMatrixStripsProps) {
  const popoverHandle = useMemo(() => Popover.createHandle(), [])
  const strips = useMemo(
    () => stripsForBiosamplePage(samples, focusMatrix),
    [samples, focusMatrix]
  )
  const matrixIds = useMemo(
    () =>
      strips
        .map((s) => s.matrixId)
        .filter((id) => id !== UNLINKED_BIOSAMPLE_STRIP_ID),
    [strips]
  )
  const { matrices, pendingCount, error } = useMatricesByIds(matrixIds)
  const matrixById = useMemo(
    () => new Map(matrices.map((m) => [m.matrixId ?? '', m])),
    [matrices]
  )
  const sampleById = useMemo(
    () => new Map(samples.map((s) => [s.id, s])),
    [samples]
  )
  const [inspect, setInspect] = useState<StripInspect | null>(null)

  function openInspect(next: StripInspect) {
    setInspect(next)
    queueMicrotask(() => popoverHandle.open(triggerId(next)))
  }

  if (!samples.length) return null

  const popoverSample =
    inspect?.kind === 'biosample-row'
      ? sampleById.get(inspect.biosampleId)
      : undefined
  const popoverMatrix =
    inspect && inspect.matrixId !== UNLINKED_BIOSAMPLE_STRIP_ID
      ? matrixById.get(inspect.matrixId)
      : undefined

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
              {inspect?.kind === 'matrix-header' && popoverMatrix ? (
                <MatrixPopoverDetails
                  matrix={popoverMatrix}
                  onNavigate={() => {
                    setInspect(null)
                    popoverHandle.close()
                  }}
                />
              ) : inspect?.kind === 'biosample-row' && popoverSample ? (
                <StripRowPopover
                  sample={popoverSample}
                  matrixId={inspect.matrixId}
                  onNavigate={() => {
                    setInspect(null)
                    popoverHandle.close()
                  }}
                />
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  Not available.
                </p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-3">
        {strips.map((strip) => {
          const unlinked = strip.matrixId === UNLINKED_BIOSAMPLE_STRIP_ID
          const matrix: Matrix | undefined = unlinked
            ? undefined
            : matrixById.get(strip.matrixId)
          const title = unlinked
            ? 'Unlinked samples'
            : matrix?.name?.trim() || shortMatrixLabel(strip.matrixId)
          const unit = matrix ? matrixUnitLabel(matrix) : undefined
          const openHref = unlinked
            ? null
            : biosampleMatrixStripHref(
                strip.matrixId,
                strip.samples.map((s) => s.id)
              )

          return (
            <section
              key={strip.matrixId}
              className="overflow-hidden rounded-lg border border-border bg-muted/20"
            >
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  {unlinked ? (
                    <p className="truncate text-sm font-medium text-foreground">
                      {title}
                    </p>
                  ) : (
                    <Popover.Trigger
                      handle={popoverHandle}
                      id={triggerId({
                        kind: 'matrix-header',
                        matrixId: strip.matrixId,
                      })}
                      type="button"
                      className="max-w-full truncate rounded-md text-left text-sm font-medium text-foreground transition-colors hover:underline"
                      onClick={() =>
                        openInspect({
                          kind: 'matrix-header',
                          matrixId: strip.matrixId,
                        })
                      }
                    >
                      {title}
                    </Popover.Trigger>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {[
                      !unlinked ? shortMatrixLabel(strip.matrixId) : null,
                      unit,
                      `${strip.samples.length} sample${
                        strip.samples.length === 1 ? '' : 's'
                      }`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {pendingCount > 0 && !unlinked && !matrix
                      ? ' · Loading matrix…'
                      : ''}
                  </p>
                </div>
                {openHref ? (
                  <Link
                    href={openHref}
                    className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Open matrix
                  </Link>
                ) : null}
              </header>
              <ul className="divide-y divide-border/60">
                {strip.samples.map((sample) => {
                  const selected = sample.id === selectedBiosampleId
                  const chips = biosampleResultChipTerms(sample).filter(
                    (c) => c.key !== 'matrices'
                  )
                  return (
                    <li
                      key={`${strip.matrixId}:${sample.id}`}
                      className={
                        selected
                          ? 'bg-[var(--scope-biosample-bg)]'
                          : 'bg-card hover:bg-muted/30'
                      }
                    >
                      <Popover.Trigger
                        handle={popoverHandle}
                        id={triggerId({
                          kind: 'biosample-row',
                          biosampleId: sample.id,
                          matrixId: strip.matrixId,
                        })}
                        type="button"
                        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 text-left transition-colors"
                        onClick={() =>
                          openInspect({
                            kind: 'biosample-row',
                            biosampleId: sample.id,
                            matrixId: strip.matrixId,
                          })
                        }
                      >
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {biosampleDisplayLabel(sample)}
                        </span>
                        {chips.slice(0, 4).map((chip) => (
                          <span
                            key={chip.key}
                            title={chip.title}
                            className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {chip.label}
                          </span>
                        ))}
                      </Popover.Trigger>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      {!strips.length && (
        <p className="text-xs text-muted-foreground">
          No matrices for these biosamples
          {focusMatrix ? ' (check matrix scope)' : ''}.
        </p>
      )}
    </div>
  )
}
