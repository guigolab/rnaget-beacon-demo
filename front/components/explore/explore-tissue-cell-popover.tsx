'use client'

import { useEffect, useState } from 'react'
import { DetailHeaderIconLink } from '@/components/shared/detail/detail-header-icon-link'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { isAbortError } from '@/lib/beacon/client'
import type { Feature, Matrix } from '@/lib/beacon/types'
import { matricesForFeatureTissue } from '@/lib/explore-tissue-matrices'
import { featureDisplayLabel, matrixViewHref } from '@/lib/gene-lens'
import {
  tissueBandLabel,
  type TissueBand,
  type TissueColumn,
} from '@/lib/tissue-levels'

type ExploreTissueCellPopoverProps = {
  feature: Feature
  column: TissueColumn
  band: TissueBand
  onNavigate?: () => void
}

export function ExploreTissueCellPopover({
  feature,
  column,
  band,
  onNavigate,
}: ExploreTissueCellPopoverProps) {
  const [matrices, setMatrices] = useState<Matrix[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const featureKey = `${feature.id}|${(feature.matrixIds ?? []).join(',')}`

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setMatrices([])

    matricesForFeatureTissue(
      feature,
      column.ontologyId,
      column.label,
      controller.signal
    )
      .then((next) => {
        if (controller.signal.aborted) return
        setMatrices(next)
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load matrices')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
    // featureKey covers id + matrixIds; full feature is read for the fetch payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid refetch on unstable feature identity
  }, [featureKey, column.ontologyId, column.label])

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
            <span className="min-w-0 truncate text-foreground/90">{column.label}</span>
          </span>
        }
        meta={tissueBandLabel(band)}
      />

      <DetailScrollBody density="popover" className="max-h-[min(70vh,28rem)] space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Matrices
        </p>
        {loading && (
          <p className="text-xs text-muted-foreground">Loading matrices…</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!loading && !error && matrices.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No matrices contain this gene and tissue.
          </p>
        )}
        {matrices.length > 0 && (
          <ul className="space-y-1.5">
            {matrices.map((matrix) => {
              const matrixId = matrix.matrixId ?? ''
              return (
                <li
                  key={matrixId}
                  className="flex items-start gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {matrix.name ?? matrixId}
                    </p>
                    {matrix.description ? (
                      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
                        {matrix.description}
                      </p>
                    ) : (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {matrixId}
                      </p>
                    )}
                  </div>
                  <DetailHeaderIconLink
                    href={matrixViewHref(matrixId, feature)}
                    label="Open matrix with this feature"
                    onClick={onNavigate}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </DetailScrollBody>
    </div>
  )
}
