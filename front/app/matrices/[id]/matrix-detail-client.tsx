'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { MatrixHeatmap } from '@/components/matrix-heatmap'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LoadingNote } from '@/components/status'
import { EndpointNote, PageFrame, PageHeader, RecordFacts } from '@/components/ui-kit'
import { getMatrix, matrixDownloads, matrixFacts, type Matrix } from '@/lib/beacon'

export function MatrixDetailClient({ id }: { id: string }) {
  const decoded = decodeURIComponent(id)
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    getMatrix(decoded)
      .then((item) => {
        if (cancelled) return
        if (!item) setError(`Matrix '${decoded}' not found`)
        else setMatrix(item)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [decoded])

  return (
    <LensPageShell>
      <PageFrame>
        <Link
          href="/matrices/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All matrices
        </Link>
        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {!matrix && !error && (
          <p className="text-sm text-muted-foreground">Loading matrix…</p>
        )}
        {matrix && (
          <>
            <PageHeader
              title={matrix.name ?? matrix.matrixId ?? id}
              id={matrix.matrixId}
              description={matrix.description}
            />
            <EndpointNote>
              {`GET /matrices/${matrix.matrixId} · GET /matrices/${matrix.matrixId}/features · GET /matrices/${matrix.matrixId}/biosamples · GET /matrices/${matrix.matrixId}/expression_values`}
            </EndpointNote>
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
              <RecordFacts title="Record" facts={matrixFacts(matrix)} />
              <RecordFacts
                title="Downloads"
                facts={[{ label: 'Files', links: matrixDownloads(matrix) }]}
              />
            </div>
            <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border bg-muted/20 px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Expression heatmap</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Windowed GET /matrices/{matrix.matrixId}/expression_values
                </p>
              </div>
              <div className="px-4 py-4">
                <Suspense fallback={<LoadingNote />}>
                  <MatrixHeatmap matrixId={decoded} />
                </Suspense>
              </div>
            </div>
          </>
        )}
      </PageFrame>
    </LensPageShell>
  )
}
