'use client'

import Link from 'next/link'
import type { Biosample, Feature } from '@/lib/beacon'

export function EntityBrowser({
  kind,
  items,
}: {
  kind: 'features' | 'biosamples'
  items: (Feature | Biosample)[]
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#dce7ea] bg-white">
      {items.map((item) => {
        const isFeature = 'genomicFeature' in item
        const label = isFeature
          ? (item as Feature).genomicFeature?.aliases?.[0]
          : (item as Biosample).sampleOriginDetail?.label ??
            (item as Biosample).sampleOriginType?.label ??
            (item as Biosample).id
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
  )
}
