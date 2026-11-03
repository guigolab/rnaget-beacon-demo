'use client'

import { useEffect, useState } from 'react'
import { DetailHeaderIconLink } from '@/components/shared/detail/detail-header-icon-link'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { Button } from '@/components/ui/button'
import { isAbortError, listExpressionValues } from '@/lib/beacon/client'
import type { Biosample, ExpressionValue, Matrix } from '@/lib/beacon/types'
import { bandLabel, type BandCellValue } from '@/lib/expression-band'
import { formatHeatmapValue } from '@/lib/heatmap-expression'
import {
  biosampleDisplayLabel,
  biosampleMatrixHeatmapHref,
} from '@/lib/sample-lens'
import { matrixUnitLabel } from '@/lib/comparability'

type BiosampleBandCellPopoverProps = {
  sample: Biosample
  matrix: Matrix
  matrixId: string
  band: BandCellValue
  onNavigate?: () => void
}

export function BiosampleBandCellPopover({
  sample,
  matrix,
  matrixId,
  band,
  onNavigate,
}: BiosampleBandCellPopoverProps) {
  const unit = matrix.expressionUnitAndScale?.unit
  const href = biosampleMatrixHeatmapHref(sample.id, matrixId)
  const [top, setTop] = useState<ExpressionValue[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded || band === 'absent') return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    listExpressionValues(matrixId, {
      biosampleIDList: sample.id,
      order: 'desc',
      limit: 5,
      signal: controller.signal,
    })
      .then((page) => {
        setTop(page.results ?? [])
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Failed to load values')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [expanded, band, sample.id, matrixId])

  return (
    <div className="text-popover-foreground">
      <DetailSurfaceHeader
        density="popover"
        title={
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {biosampleDisplayLabel(sample)}
            </span>
            <span className="shrink-0 text-base font-normal text-muted-foreground" aria-hidden>
              ×
            </span>
            <span className="min-w-0 truncate text-foreground/90">
              {matrix.name ?? matrixId}
            </span>
          </span>
        }
        meta={matrixUnitLabel(matrix)}
        actions={
          <DetailHeaderIconLink href={href} label="Open in matrix" onClick={onNavigate} />
        }
      />

      <DetailScrollBody density="popover" className="max-h-[min(70vh,26rem)] space-y-3">
        <p className="text-sm">
          <span className="text-muted-foreground">Detected-genes band · </span>
          <span className="font-medium text-foreground">{bandLabel(band)}</span>
        </p>

        {band !== 'absent' && (
          <div className="space-y-2">
            {!expanded ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setExpanded(true)}
              >
                Top features by value
              </Button>
            ) : (
              <>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Top values
                  {unit ? ` (${unit})` : ''}
                </p>
                {loading && (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                )}
                {error && <p className="text-xs text-destructive">{error}</p>}
                {!loading && !error && top && top.length === 0 && (
                  <p className="text-xs text-muted-foreground">No expression values.</p>
                )}
                {top && top.length > 0 && (
                  <ul className="space-y-1">
                    {top.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-baseline justify-between gap-2 font-mono text-xs"
                      >
                        <span className="min-w-0 truncate text-muted-foreground">
                          {row.featureId}
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground">
                          {formatHeatmapValue(row.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </DetailScrollBody>
    </div>
  )
}
