'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { EndpointNote, RecordFacts } from '@/components/ui-kit'
import {
  biosampleFacts,
  featureFacts,
  getFilteringTerms,
  listRelatedMatrices,
  matrixHref,
  type Biosample,
  type Feature,
  type FilteringResource,
  type Matrix,
} from '@/lib/beacon'

export function EntityDetailPanel({
  kind,
  item,
}: {
  kind: 'feature' | 'biosample'
  item: Feature | Biosample
}) {
  const feature = kind === 'feature' ? (item as Feature) : null
  const sample = kind === 'biosample' ? (item as Biosample) : null
  const title = feature?.genomicFeature?.aliases?.[0] ?? sample?.id ?? item.id
  const [resources, setResources] = useState<FilteringResource[]>([])
  const [matrices, setMatrices] = useState<Matrix[] | null>(null)
  const [matrixTotal, setMatrixTotal] = useState<number | null>(null)
  const [matrixError, setMatrixError] = useState('')

  useEffect(() => {
    if (kind !== 'feature') return
    let cancelled = false
    getFilteringTerms()
      .then((terms) => {
        if (!cancelled) setResources(terms.resources)
      })
      .catch(() => {
        if (!cancelled) setResources([])
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  useEffect(() => {
    let cancelled = false
    setMatrices(null)
    setMatrixError('')
    listRelatedMatrices(kind, item.id)
      .then((page) => {
        if (cancelled) return
        setMatrices(page.results)
        setMatrixTotal(page.total ?? page.results.length)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMatrixError(err instanceof Error ? err.message : 'Related matrices failed')
        }
      })
    return () => {
      cancelled = true
    }
  }, [kind, item.id])

  const fallbackIds = feature?.matrixIds ?? sample?.matrixIds ?? []
  const cohortQuery =
    kind === 'feature'
      ? `featureIds=${encodeURIComponent(item.id)}`
      : `biosampleIds=${encodeURIComponent(item.id)}`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold leading-snug text-foreground">{title}</h2>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{item.id}</p>
        <EndpointNote>
          {kind === 'feature'
            ? `GET /features/${item.id} · GET /features/${item.id}/matrices`
            : `GET /biosamples/${item.id} · GET /biosamples/${item.id}/matrices`}
        </EndpointNote>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid items-start gap-4">
          <RecordFacts
            title="Record"
            facts={
              feature ? featureFacts(feature, resources) : biosampleFacts(sample as Biosample)
            }
          />
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
        </div>
      </div>
    </div>
  )
}
