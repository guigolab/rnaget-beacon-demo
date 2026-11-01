'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

/** URL-synced chips for genes / matrices (shareable compare & gene lens links). */
export function SelectionTray() {
  const search = useSearchParams()
  const genes = (search.get('genes') ?? '').split(',').filter(Boolean)
  const matrices = (search.get('matrices') ?? search.get('matrix') ?? '')
    .split(',')
    .filter(Boolean)

  if (!genes.length && !matrices.length) return null

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[#dfe7eb] bg-[#f4f8f9] px-3 py-2 text-xs"
      aria-label="Current selection"
    >
      <span className="font-medium text-[#52666f]">Selection</span>
      {genes.map((g) => (
        <span key={g} className="rounded-full bg-white px-2 py-0.5 font-mono">
          {g}
        </span>
      ))}
      {matrices.map((m) => (
        <Link
          key={m}
          href={`/matrices/${encodeURIComponent(m)}`}
          className="rounded-full bg-[#0c7c86]/10 px-2 py-0.5 font-mono text-[#0c6870] hover:underline"
        >
          {m}
        </Link>
      ))}
    </div>
  )
}
