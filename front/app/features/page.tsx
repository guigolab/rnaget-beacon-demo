'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { PageIntro, Pagination } from '@/components/ui-kit'
import { EntityBrowser } from '@/components/entity-browser'
import { listFeatures, type Feature } from '@/lib/rnaget'

function FeaturesInner() {
  const searchParams = useSearchParams()
  const skip = Number(searchParams.get('skip') ?? 0)
  const [data, setData] = useState<{ results: Feature[]; total: number } | null>(
    null
  )
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    listFeatures(skip, 20)
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
    <div className="mx-auto max-w-5xl px-5 py-14">
      <PageIntro
        eyebrow="Search"
        title="Genes & features"
        description="Find genomic features in the current page, or open a feature by pasting its native identifier."
      />
      {error && (
        <p className="mb-4 rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="text-sm text-[#71818a]">Loading features…</p>
      )}
      {data && (
        <>
          <EntityBrowser kind="features" items={data.results} />
          <div className="mt-5">
            <Pagination
              skip={skip}
              limit={20}
              total={data.total}
              base="/features/"
            />
          </div>
        </>
      )}
    </div>
  )
}

export default function FeaturesPage() {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-14 text-sm text-[#71818a]">Loading…</p>}>
        <FeaturesInner />
      </Suspense>
    </AppShell>
  )
}
