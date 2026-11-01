'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Biosample, Feature } from '@/lib/rnaget'

export function EntityBrowser({
  kind,
  items,
}: {
  kind: 'features' | 'biosamples'
  items: (Feature | Biosample)[]
}) {
  const [filter, setFilter] = useState('')
  const filtered = items.filter((item) =>
    JSON.stringify(item).toLowerCase().includes(filter.toLowerCase())
  )
  return (
    <>
      <div className="mb-5 flex max-w-xl items-center gap-3 rounded-lg border border-[#cbd9de] bg-white px-3">
        <span className="text-[#829198]">/</span>
        <input
          aria-label={`Filter ${kind}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter current page of ${kind}…`}
          className="w-full py-3 text-sm outline-none"
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-[#dce7ea] bg-white">
        {filtered.map((item) => {
          const isFeature = 'genomicFeature' in item
          const label = isFeature
            ? (item as Feature).genomicFeature?.aliases?.[0]
            : (item as Biosample).id
          const id = item.id
          const href =
            kind === 'features'
              ? `/features/detail/?id=${encodeURIComponent(id)}`
              : `/biosamples/detail/?id=${encodeURIComponent(id)}`
          return (
            <Link
              key={id}
              href={href}
              className="block border-b border-[#e8eef0] px-5 py-4 last:border-0 hover:bg-[#f5faf9]"
            >
              <p className="font-medium">{label}</p>
              <p className="mt-1 font-mono text-xs text-[#829198]">{id}</p>
              {isFeature && (
                <p className="mt-1 text-xs text-[#71818a]">
                  {(item as Feature).genomicFeature?.featureType?.label}
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </>
  )
}
