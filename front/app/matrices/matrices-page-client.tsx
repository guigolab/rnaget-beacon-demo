'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { EndpointNote, PageFrame, PageHeader, Pagination } from '@/components/ui-kit'
import { listMatrices, matrixHref, type Matrix } from '@/lib/beacon'

function MatricesInner() {
  const searchParams = useSearchParams()
  const skip = Number(searchParams.get('skip') ?? 0)
  const [data, setData] = useState<{ results: Matrix[]; total: number } | null>(
    null
  )
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    listMatrices(skip, 10)
      .then((page) => {
        if (!cancelled) {
          setData({
            results: page.results,
            total: page.total ?? page.results.length,
          })
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [skip])

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Catalog"
        title="Expression matrices"
        description="Browse datasets available through the RNA-Get endpoint. Select a matrix to inspect its annotation, dimensions, and expression values."
      />
      <EndpointNote>GET /matrices</EndpointNote>
      {error && (
        <p className="mt-6 rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">{error}</p>
      )}
      {!data && !error && <p className="mt-6 text-sm text-[#71818a]">Loading matrices…</p>}
      {data && (
        <div className="mt-6">
          <div className="overflow-hidden rounded-xl border border-[#dce7ea] bg-white">
            <div className="hidden grid-cols-[2fr_1.2fr_1fr_1fr] gap-4 border-b border-[#e5ecee] bg-[#f7fafb] px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#789098] sm:grid">
              <span>Matrix</span>
              <span>Assay</span>
              <span>Annotation</span>
              <span>Dimensions</span>
            </div>
            {data.results.map((matrix) => (
              <Link
                key={matrix.matrixId}
                href={matrixHref(matrix.matrixId)}
                className="grid gap-2 border-b border-[#e8eef0] px-5 py-4 transition last:border-0 hover:bg-[#f5faf9] sm:grid-cols-[2fr_1.2fr_1fr_1fr] sm:items-center sm:gap-4"
              >
                <div>
                  <p className="font-medium text-[#1f343d]">{matrix.name ?? matrix.matrixId}</p>
                  <p className="mt-1 truncate font-mono text-xs text-[#8a999f]">{matrix.matrixId}</p>
                </div>
                <span className="text-sm text-[#52666f]">{matrix.assayType?.label ?? '—'}</span>
                <span className="text-sm text-[#52666f]">
                  {[matrix.annotation?.source, matrix.annotation?.version].filter(Boolean).join(' ') ||
                    '—'}
                </span>
                <span className="text-sm text-[#52666f]">
                  {matrix.dimensions?.features?.toLocaleString()} ×{' '}
                  {matrix.dimensions?.biosamples?.toLocaleString()}
                </span>
              </Link>
            ))}
          </div>
          <Pagination
            skip={skip}
            limit={10}
            total={data.total}
            href={(nextSkip) =>
              nextSkip ? `/matrices/?skip=${nextSkip}&limit=10` : '/matrices/?limit=10'
            }
          />
        </div>
      )}
    </PageFrame>
  )
}

export function MatricesPageClient() {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-14 text-sm text-[#71818a]">Loading…</p>}>
        <MatricesInner />
      </Suspense>
    </AppShell>
  )
}
