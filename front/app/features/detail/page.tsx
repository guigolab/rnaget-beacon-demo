'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { EntityDetail } from '@/components/entity-detail'
import { getFeature, type Feature } from '@/lib/rnaget'

function FeatureDetailInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const [item, setItem] = useState<Feature | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) {
      setError('Missing feature id')
      return
    }
    let cancelled = false
    getFeature(id)
      .then((f) => {
        if (!cancelled) setItem(f)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) {
    return (
      <p className="mx-auto max-w-5xl px-5 py-14 text-sm text-[#a34c3b]">
        {error}
      </p>
    )
  }
  if (!item) {
    return (
      <p className="mx-auto max-w-5xl px-5 py-14 text-sm text-[#71818a]">
        Loading feature…
      </p>
    )
  }
  return <EntityDetail kind="feature" item={item} />
}

export default function FeatureDetailPage() {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-14 text-sm text-[#71818a]">Loading…</p>}>
        <FeatureDetailInner />
      </Suspense>
    </AppShell>
  )
}
