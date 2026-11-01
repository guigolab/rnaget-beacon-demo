import { Suspense } from 'react'
import { FALLBACK_MATRIX_IDS } from '@/lib/rnaget'
import { MatrixDetailClient } from './matrix-detail-client'

async function idsFromApi(base: string): Promise<string[]> {
  const res = await fetch(`${base}/matrices?skip=0&limit=100`, { cache: 'no-store' })
  if (!res.ok) return []
  const data = await res.json()
  const results = data?.response?.resultSets?.[0]?.results ?? []
  return results
    .map((matrix: { matrixId?: string }) => matrix.matrixId)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
}

export async function generateStaticParams() {
  const fromEnv = process.env.MATRIX_IDS?.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const discovered = new Set<string>(fromEnv?.length ? fromEnv : FALLBACK_MATRIX_IDS)
  if (!fromEnv?.length) {
    const bases = [
      process.env.API_BUILD_URL,
      process.env.NEXT_PUBLIC_API_BASE_URL,
      'http://127.0.0.1:5000',
    ]
      .map((value) => value?.trim().replace(/\/$/, ''))
      .filter((value): value is string => Boolean(value))
    for (const base of bases) {
      try {
        const ids = await idsFromApi(base)
        if (!ids.length) continue
        for (const id of ids) discovered.add(id)
        break
      } catch {
        // The next candidate may be the local API.
      }
    }
  }
  return [...discovered].map((id) => ({ id }))
}

export default async function MatrixDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Suspense fallback={<p className="px-5 py-10 text-sm text-[#71818a]">Loading…</p>}>
      <MatrixDetailClient id={id} />
    </Suspense>
  )
}
