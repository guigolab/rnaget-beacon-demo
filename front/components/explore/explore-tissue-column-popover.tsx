'use client'

import { useEffect, useState } from 'react'
import { DetailHeaderIconLink } from '@/components/shared/detail/detail-header-icon-link'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { isAbortError } from '@/lib/beacon/client'
import {
  matrixBiosampleCountsForTissue,
  type TissueMatrixBiosampleCount,
} from '@/lib/explore-tissue-matrices'
import { matrixViewHref } from '@/lib/gene-lens'
import type { TissueColumn } from '@/lib/tissue-levels'

type ExploreTissueColumnPopoverProps = {
  column: TissueColumn
  onNavigate?: () => void
}

export function ExploreTissueColumnPopover({
  column,
  onNavigate,
}: ExploreTissueColumnPopoverProps) {
  const [rows, setRows] = useState<TissueMatrixBiosampleCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setRows([])

    matrixBiosampleCountsForTissue(
      column.ontologyId,
      column.label,
      controller.signal
    )
      .then((next) => {
        if (controller.signal.aborted) return
        setRows(next)
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load matrices')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [column.ontologyId, column.label])

  const totalBiosamples = rows.reduce((sum, row) => sum + row.biosampleCount, 0)

  return (
    <div className="text-popover-foreground">
      <DetailSurfaceHeader
        density="popover"
        title={column.label}
        subtitle={column.ontologyId}
        meta={
          loading
            ? 'Loading matrices…'
            : `${totalBiosamples.toLocaleString()} biosamples · ${rows.length.toLocaleString()} matrices`
        }
      />
      <DetailScrollBody density="popover" className="max-h-[min(70vh,26rem)] space-y-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No matrices with biosamples for this tissue.
          </p>
        )}
        {rows.length > 0 && (
          <ul className="space-y-1.5">
            {rows.map(({ matrix, biosampleCount }) => {
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
                    <p className="mt-0.5 tabular-nums text-[11px] text-muted-foreground">
                      {biosampleCount.toLocaleString()} biosample
                      {biosampleCount === 1 ? '' : 's'}
                    </p>
                    {matrix.description ? (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {matrix.description}
                      </p>
                    ) : null}
                  </div>
                  <DetailHeaderIconLink
                    href={matrixViewHref(matrixId)}
                    label="Open matrix"
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
