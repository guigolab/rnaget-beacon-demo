'use client'

import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { Biosample, Feature } from '@/lib/rnaget'

export function EntityDetail({
  kind,
  item,
}: {
  kind: 'feature' | 'biosample'
  item: Feature | Biosample
}) {
  const feature = kind === 'feature' ? (item as Feature) : null
  const sample = kind === 'biosample' ? (item as Biosample) : null
  const title =
    feature?.genomicFeature?.aliases?.[0] ?? sample?.id ?? item.id
  const listHref = kind === 'feature' ? '/features/' : '/biosamples/'
  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <Link
        href={listHref}
        className="mb-8 inline-flex items-center gap-2 text-sm text-[#71818a] hover:text-[#0c7c86]"
      >
        <ArrowLeft />
        Back to {kind === 'feature' ? 'genes' : 'biosamples'}
      </Link>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#0c7c86]">
        {kind} detail
      </p>
      <h1 className="font-serif text-5xl tracking-tight">{title}</h1>
      <p className="mt-3 font-mono text-xs text-[#829198]">{item.id}</p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <div className="rounded-xl border border-[#dce7ea] bg-white p-5">
          <p className="text-xs uppercase tracking-wider text-[#829198]">
            Metadata
          </p>
          {feature ? (
            <>
              <p className="mt-4 text-sm">
                <span className="text-[#829198]">Feature type</span>
                <br />
                {feature.genomicFeature?.featureType?.label}
              </p>
              <p className="mt-4 text-sm">
                <span className="text-[#829198]">Aliases</span>
                <br />
                {feature.genomicFeature?.aliases?.join(', ')}
              </p>
              <p className="mt-4 text-sm">
                <span className="text-[#829198]">Native ID</span>
                <br />
                {feature.genomicFeature?.featureIdentifier?.id}
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm">
                <span className="text-[#829198]">Origin</span>
                <br />
                {sample?.sampleOriginType?.label ??
                  sample?.sampleType?.label ??
                  '—'}
              </p>
              <p className="mt-4 text-sm">
                <span className="text-[#829198]">Status</span>
                <br />
                {typeof sample?.biosampleStatus === 'string'
                  ? sample.biosampleStatus
                  : '—'}
              </p>
            </>
          )}
        </div>
        <div className="rounded-xl border border-[#dce7ea] bg-white p-5">
          <p className="text-xs uppercase tracking-wider text-[#829198]">
            Related matrices
          </p>
          <p className="mt-4 text-sm leading-6 text-[#71818a]">
            This entity is available in the following expression matrices.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {(feature?.matrixIds ?? sample?.matrixIds ?? []).map((id) => (
              <Link
                key={id}
                href={`/matrices/${encodeURIComponent(id)}/`}
                className="flex items-center justify-between rounded-md bg-[#f5faf9] px-3 py-2 text-sm text-[#0c6870] hover:bg-[#eaf4f2]"
              >
                {id}
                <ExternalLink />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
