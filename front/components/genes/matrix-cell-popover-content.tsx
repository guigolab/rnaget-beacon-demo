'use client'

import Link from 'next/link'
import { EntityRecordLink } from '@/components/shared/entity-record-link'
import { BiosampleExtremeCard } from '@/components/genes/biosample-extreme-card'
import { ExpressionCohortStatsVisual } from '@/components/genes/expression-cohort-stats-visual'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Matrix } from '@/lib/beacon/types'
import type { Feature } from '@/lib/beacon/types'
import { featureDisplayLabel, matrixViewHref } from '@/lib/gene-lens'
import { matrixUnitLabel } from '@/lib/comparability'

type MatrixCellPopoverContentProps = {
  feature: Feature
  matrix: Matrix
  matrixId: string
  median?: number
  summary?: ExpressionSummary
  onNavigate?: () => void
}

export function MatrixCellPopoverContent({
  feature,
  matrix,
  matrixId,
  median,
  summary,
  onNavigate,
}: MatrixCellPopoverContentProps) {
  const matrixRange = matrix.expressionValueRange ?? {}
  const unit = matrix.expressionUnitAndScale?.unit
  const href = matrixViewHref(matrixId, feature)
  const matrixLabel = matrix.name ?? matrixId
  const geneLabel = featureDisplayLabel(feature)

  const minBid = summary?.minBiosampleId
  const maxBid = summary?.maxBiosampleId
  const sameExtreme = minBid && maxBid && minBid === maxBid

  return (
    <div className="text-popover-foreground">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold leading-snug">
          <span className="min-w-0 [overflow-wrap:anywhere]">{geneLabel}</span>
          <span className="shrink-0 text-base font-normal text-muted-foreground" aria-hidden>
            ×
          </span>
          <span className="min-w-0 truncate text-foreground/90">{matrixLabel}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{matrixUnitLabel(matrix)}</p>
      </div>

      <div className="max-h-[min(70vh,26rem)] space-y-3 overflow-y-auto px-3 py-2.5 text-xs">
        {!summary ? (
          <p className="text-muted-foreground">No expression summary for this cell.</p>
        ) : (
          <>
            <ExpressionCohortStatsVisual
              summary={summary}
              median={median}
              matrixMin={matrixRange.min}
              matrixMax={matrixRange.max}
              unit={unit}
            />

            {summary.group && (
              <p className="text-muted-foreground">
                Group{' '}
                <span className="font-medium text-foreground">
                  {summary.group.label ?? summary.group.id}
                </span>
              </p>
            )}

            {(minBid || maxBid) && (
              <div className="flex flex-row gap-2">
                {sameExtreme && minBid ? (
                  <BiosampleExtremeCard
                    biosampleId={minBid}
                    role="sole"
                    expressionValue={summary.min ?? summary.median}
                    unit={unit}
                    compact
                  />
                ) : (
                  <>
                    {minBid && (
                      <BiosampleExtremeCard
                        biosampleId={minBid}
                        role="min"
                        expressionValue={summary.min}
                        unit={unit}
                        compact
                      />
                    )}
                    {maxBid && maxBid !== minBid && (
                      <BiosampleExtremeCard
                        biosampleId={maxBid}
                        role="max"
                        expressionValue={summary.max}
                        unit={unit}
                        compact
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <EntityRecordLink
            kind="feature"
            id={feature.id}
            onActivate={onNavigate}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Full feature record
          </EntityRecordLink>
          <Link
            href={href}
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => onNavigate?.()}
          >
            Open matrix with this feature
          </Link>
        </div>
      </div>
    </div>
  )
}
