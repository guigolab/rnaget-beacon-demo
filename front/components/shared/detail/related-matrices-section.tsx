'use client'

import Link from 'next/link'
import { matrixHref, type Matrix } from '@/lib/beacon'

type RelatedMatricesSectionProps = {
  kind: 'feature' | 'biosample'
  entityId: string
  matrices: Matrix[] | null
  matrixTotal: number | null
  matrixError: string
  fallbackIds: string[]
}

export function RelatedMatricesSection({
  kind,
  entityId,
  matrices,
  matrixTotal,
  matrixError,
  fallbackIds,
}: RelatedMatricesSectionProps) {
  const cohortQuery =
    kind === 'feature'
      ? `featureIds=${encodeURIComponent(entityId)}`
      : `biosampleIds=${encodeURIComponent(entityId)}`

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        Related matrices
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        From the {kind} matrices endpoint
        {matrixTotal != null ? ` · ${matrixTotal.toLocaleString()} total` : ''}.
      </p>
      {matrices === null && !matrixError && (
        <p className="mt-3 text-sm text-muted-foreground">Loading related matrices…</p>
      )}
      {matrixError && (
        <p className="mt-3 text-sm text-destructive">
          {matrixError}. Showing ids stored on the record.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {matrices
          ? matrices.map((matrix) => (
              <Link
                key={matrix.matrixId}
                href={matrixHref(matrix.matrixId ?? '', cohortQuery)}
                className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span className="block font-medium text-foreground">
                  {matrix.name ?? matrix.matrixId}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {matrix.matrixId}
                </span>
              </Link>
            ))
          : matrixError
            ? fallbackIds.map((id) => (
                <Link
                  key={id}
                  href={matrixHref(id, cohortQuery)}
                  className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm text-primary hover:bg-muted/50"
                >
                  {id}
                </Link>
              ))
            : null}
      </div>
    </section>
  )
}
