'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { MatrixHeatmap } from '@/components/matrix-heatmap'
import { getMatrix, type Matrix } from '@/lib/rnaget'

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[#cbd9de] bg-white px-3 py-1.5 text-sm text-[#52666f]">
      {children}
    </span>
  )
}

export function MatrixDetailClient({ id }: { id: string }) {
  const decoded = decodeURIComponent(id)
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    getMatrix(decoded)
      .then((m) => {
        if (!cancelled) setMatrix(m)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [decoded])

  const featureCount = matrix?.dimensions?.features
  const biosampleCount = matrix?.dimensions?.biosamples

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-5 py-10">
        <Link
          href="/matrices/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-[#71818a] hover:text-[#0c7c86]"
        >
          <ArrowLeft />
          All matrices
        </Link>
        {error && (
          <p className="rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">
            {error}
          </p>
        )}
        {!matrix && !error && (
          <p className="text-sm text-[#71818a]">Loading matrix…</p>
        )}
        {matrix && (
          <>
            <header className="border-b border-[#dce7ea] pb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#0c7c86]">
                Matrix detail
              </p>
              <h1 className="max-w-4xl font-serif text-3xl tracking-tight sm:text-4xl">
                {matrix.name ?? matrix.matrixId}
              </h1>
              <p className="mt-2 font-mono text-xs text-[#829198]">
                {matrix.matrixId}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {featureCount != null && (
                  <Chip>{featureCount.toLocaleString()} features</Chip>
                )}
                {biosampleCount != null && (
                  <Chip>{biosampleCount.toLocaleString()} biosamples</Chip>
                )}
                {matrix.assayType?.label && (
                  <Chip>{matrix.assayType.label}</Chip>
                )}
                {matrix.assembly?.name && <Chip>{matrix.assembly.name}</Chip>}
                {matrix.expressionUnitAndScale?.unit && (
                  <Chip>{matrix.expressionUnitAndScale.unit}</Chip>
                )}
                {matrix.expressionUnitAndScale?.scale && (
                  <Chip>{matrix.expressionUnitAndScale.scale}</Chip>
                )}
              </div>
            </header>
            <MatrixHeatmap matrixId={decoded} />
          </>
        )}
      </div>
    </AppShell>
  )
}
