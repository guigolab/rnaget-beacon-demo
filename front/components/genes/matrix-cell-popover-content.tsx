'use client'

import { DetailHeaderIconLink } from '@/components/shared/detail/detail-header-icon-link'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import type { Matrix } from '@/lib/beacon/types'
import type { Feature } from '@/lib/beacon/types'
import { featureDisplayLabel, matrixViewHref } from '@/lib/gene-lens'
import { matrixUnitLabel } from '@/lib/comparability'
import type { ReactNode } from 'react'

type MatrixCellPopoverContentProps = {
  feature: Feature
  matrix: Matrix
  matrixId: string
  /** Biosample-specific value from the heatmap cell that opened the popover. */
  selectedSample?: {
    biosampleId: string
    label?: string
    value: number
  }
  onNavigate?: () => void
  /** Hide the link back to this matrix workspace (already open). */
  showMatrixLink?: boolean
  footer?: ReactNode
}

export function MatrixCellPopoverContent({
  feature,
  matrix,
  matrixId,
  selectedSample,
  onNavigate,
  showMatrixLink = true,
  footer,
}: MatrixCellPopoverContentProps) {
  const unit = matrix.expressionUnitAndScale?.unit
  const href = matrixViewHref(matrixId, feature)
  const matrixLabel = matrix.name ?? matrixId
  const geneLabel = featureDisplayLabel(feature)

  return (
    <div className="text-popover-foreground">
      <DetailSurfaceHeader
        density="popover"
        title={
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="min-w-0 [overflow-wrap:anywhere]">{geneLabel}</span>
            <span className="shrink-0 text-base font-normal text-muted-foreground" aria-hidden>
              ×
            </span>
            <span className="min-w-0 truncate text-foreground/90">{matrixLabel}</span>
          </span>
        }
        meta={matrixUnitLabel(matrix)}
        actions={
          showMatrixLink ? (
            <DetailHeaderIconLink
              href={href}
              label="Open feature in matrix"
              onClick={onNavigate}
            />
          ) : null
        }
      />

      <DetailScrollBody density="popover" className="max-h-[min(70vh,26rem)] space-y-3">
        {selectedSample ? (
          <p className="rounded-md border border-border/80 bg-muted/30 px-2.5 py-2 text-xs">
            <span className="text-muted-foreground">This biosample · </span>
            <span className="font-medium text-foreground">
              {selectedSample.label ?? selectedSample.biosampleId}
            </span>
            <span className="mt-1 block font-mono tabular-nums text-primary">
              {selectedSample.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              {unit ? ` ${unit}` : ''}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Open a cell to see its expression value.
          </p>
        )}
        {footer}
      </DetailScrollBody>
    </div>
  )
}
