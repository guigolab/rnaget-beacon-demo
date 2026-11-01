'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { EntityDetail } from '@/components/entity-detail'
import { getBiosample, type Biosample } from '@/lib/rnaget'

function BiosampleDetailInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const [item, setItem] = useState<Biosample | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) {
      setError('Missing biosample id')
      return
    }
    let cancelled = false
    getBiosample(id)
      .then((b) => {
        if (!cancelled) setItem(b)
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
        Loading biosample…
      </p>
    )
  }
  return <EntityDetail kind="biosample" item={item} />
}

export default function BiosampleDetailPage() {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-14 text-sm text-[#71818a]">Loading…</p>}>
        <BiosampleDetailInner />
      </Suspense>
    </AppShell>
  )
}
