import { FALLBACK_MATRIX_IDS } from '@/lib/rnaget'
import { MatrixDetailClient } from './matrix-detail-client'

export async function generateStaticParams() {
  const fromEnv = process.env.MATRIX_IDS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromEnv?.length) {
    return fromEnv.map((id) => ({ id }))
  }
  const buildUrl = process.env.API_BUILD_URL?.replace(/\/$/, '')
  if (buildUrl) {
    try {
      const res = await fetch(`${buildUrl}/matrices?skip=0&limit=100`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        const results =
          data?.response?.resultSets?.[0]?.results ?? []
        const ids = results
          .map((m: { matrixId?: string }) => m.matrixId)
          .filter(Boolean)
        if (ids.length) return ids.map((id: string) => ({ id }))
      }
    } catch {
      // fall through
    }
  }
  return FALLBACK_MATRIX_IDS.map((id) => ({ id }))
}

export default async function MatrixDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <MatrixDetailClient id={id} />
}
