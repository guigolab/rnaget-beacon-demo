'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { PageIntro, Pagination } from '@/components/ui-kit'
import { listMatrices, type Matrix } from '@/lib/rnaget'

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
        if (!cancelled) setData(page)
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
    <div className="mx-auto max-w-6xl px-5 py-14">
      <PageIntro
        eyebrow="Catalog"
        title="Expression matrices"
        description="Browse datasets available through the RNA-Get endpoint. Select a matrix to inspect its dimensions and query values."
      />
      {error && (
        <p className="mb-4 rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="text-sm text-[#71818a]">Loading matrices…</p>
      )}
      {data && (
        <>
          <div className="overflow-hidden rounded-xl border border-[#dce7ea] bg-white">
            <div className="hidden grid-cols-[2fr_1.2fr_1fr_1fr] gap-4 border-b border-[#e5ecee] bg-[#f7fafb] px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#789098] sm:grid">
              <span>Matrix</span>
              <span>Assay</span>
              <span>Assembly</span>
              <span>Dimensions</span>
            </div>
            {data.results.map((m) => (
              <Link
                key={m.matrixId}
                href={`/matrices/${encodeURIComponent(m.matrixId)}/`}
                className="grid gap-2 border-b border-[#e8eef0] px-5 py-5 transition last:border-0 hover:bg-[#f5faf9] sm:grid-cols-[2fr_1.2fr_1fr_1fr] sm:items-center sm:gap-4"
              >
                <div>
                  <p className="font-medium text-[#1f343d]">
                    {m.name ?? m.matrixId}
                  </p>
                  <p className="mt-1 truncate text-xs text-[#8a999f]">
                    {m.matrixId}
                  </p>
                </div>
                <span className="text-sm text-[#52666f]">
                  {m.assayType?.label ?? '—'}
                </span>
                <span className="text-sm text-[#52666f]">
                  {m.assembly?.name ?? '—'}
                </span>
                <span className="text-sm text-[#52666f]">
                  {m.dimensions?.features?.toLocaleString()} ×{' '}
                  {m.dimensions?.biosamples?.toLocaleString()}
                </span>
              </Link>
            ))}
          </div>
          <div className="mt-5">
            <Pagination
              skip={skip}
              limit={10}
              total={data.total}
              base="/matrices/"
            />
          </div>
        </>
      )}
    </div>
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
