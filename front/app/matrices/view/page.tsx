'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { MatrixDetailClient } from '../[id]/matrix-detail-client'

function MatrixViewInner() {
  const id = useSearchParams().get('id') ?? ''
  if (!id) {
    return <p className="p-14 text-sm text-[#71818a]">Missing matrix id.</p>
  }
  return <MatrixDetailClient id={id} />
}

export default function MatrixViewPage() {
  return (
    <Suspense fallback={<p className="p-14 text-sm text-[#71818a]">Loading…</p>}>
      <MatrixViewInner />
    </Suspense>
  )
}
