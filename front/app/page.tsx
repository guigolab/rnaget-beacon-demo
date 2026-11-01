import { Suspense } from 'react'
import { HomePage } from '@/components/home-page'

export default function Page() {
  return (
    <Suspense fallback={<p className="px-5 py-10 text-sm text-[#71818a]">Loading…</p>}>
      <HomePage />
    </Suspense>
  )
}
