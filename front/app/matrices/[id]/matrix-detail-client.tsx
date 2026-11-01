'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { MatrixHeatmap } from '@/components/matrix-heatmap'
import { EndpointNote, PageFrame, PageHeader, RecordFacts } from '@/components/ui-kit'
import { AppShell } from '@/components/app-shell'
import { matrixDownloads, matrixFacts, type Matrix } from '@/lib/beacon'
import { getMatrix } from '@/lib/rnaget'

export function MatrixDetailClient({ id }: { id: string }) {
  const decoded = decodeURIComponent(id)
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    getMatrix(decoded)
      .then((item) => {
        if (!cancelled) setMatrix(item)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [decoded])

  return (
    <AppShell>
      <PageFrame>
        <Link
          href="/matrices/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-[#71818a] hover:text-[#0c7c86]"
        >
          <ArrowLeft className="size-4" />
          All matrices
        </Link>
        {error && (
          <p className="rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">{error}</p>
        )}
        {!matrix && !error && <p className="text-sm text-[#71818a]">Loading matrix…</p>}
        {matrix && (
          <>
            <PageHeader
              eyebrow="Matrix"
              title={matrix.name ?? matrix.matrixId}
              id={matrix.matrixId}
              description={matrix.description}
            />
            <EndpointNote>
              {`GET /matrices/${matrix.matrixId} · GET /matrices/${matrix.matrixId}/features · GET /matrices/${matrix.matrixId}/biosamples · GET /matrices/${matrix.matrixId}/expression_values`}
            </EndpointNote>
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
              <RecordFacts title="Record" facts={matrixFacts(matrix)} />
              <RecordFacts title="Downloads" facts={[{ label: 'Files', links: matrixDownloads(matrix) }]} />
            </div>
            <Suspense fallback={<p className="mt-6 text-sm text-[#71818a]">Loading heatmap…</p>}>
              <MatrixHeatmap matrixId={decoded} />
            </Suspense>
          </>
        )}
      </PageFrame>
    </AppShell>
  )
}
