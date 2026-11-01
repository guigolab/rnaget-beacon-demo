'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { EndpointNote, PageFrame, PageHeader, RecordFacts } from '@/components/ui-kit'
import {
  biosampleFacts,
  featureFacts,
  getFilteringTerms,
  listRelatedMatrices,
  matrixHref,
  type Biosample,
  type Feature,
  type FilteringResource,
  type Matrix,
} from '@/lib/beacon'

export function EntityDetail({
  kind,
  item,
}: {
  kind: 'feature' | 'biosample'
  item: Feature | Biosample
}) {
  const feature = kind === 'feature' ? (item as Feature) : null
  const sample = kind === 'biosample' ? (item as Biosample) : null
  const title = feature?.genomicFeature?.aliases?.[0] ?? sample?.id ?? item.id
  const listHref = kind === 'feature' ? '/features/' : '/biosamples/'
  const [resources, setResources] = useState<FilteringResource[]>([])
  const [matrices, setMatrices] = useState<Matrix[] | null>(null)
  const [matrixTotal, setMatrixTotal] = useState<number | null>(null)
  const [matrixError, setMatrixError] = useState('')

  useEffect(() => {
    if (kind !== 'feature') return
    let cancelled = false
    getFilteringTerms()
      .then((terms) => {
        if (!cancelled) setResources(terms.resources)
      })
      .catch(() => {
        if (!cancelled) setResources([])
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  useEffect(() => {
    let cancelled = false
    setMatrices(null)
    setMatrixError('')
    listRelatedMatrices(kind, item.id)
      .then((page) => {
        if (cancelled) return
        setMatrices(page.results)
        setMatrixTotal(page.total ?? page.results.length)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMatrixError(err instanceof Error ? err.message : 'Related matrices failed')
        }
      })
    return () => {
      cancelled = true
    }
  }, [kind, item.id])

  const fallbackIds = feature?.matrixIds ?? sample?.matrixIds ?? []
  const cohortQuery =
    kind === 'feature'
      ? `featureIds=${encodeURIComponent(item.id)}`
      : `biosampleIds=${encodeURIComponent(item.id)}`

  return (
    <PageFrame>
      <Link
        href={listHref}
        className="mb-6 inline-flex items-center gap-2 text-sm text-[#71818a] hover:text-[#0c7c86]"
      >
        <ArrowLeft className="size-4" />
        Back to {kind === 'feature' ? 'genes' : 'biosamples'}
      </Link>
      <PageHeader
        eyebrow={kind === 'feature' ? 'Feature' : 'Biosample'}
        title={title}
        id={item.id}
      />
      <EndpointNote>
        {kind === 'feature'
          ? `GET /features/${item.id} · GET /features/${item.id}/matrices`
          : `GET /biosamples/${item.id} · GET /biosamples/${item.id}/matrices`}
      </EndpointNote>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <RecordFacts
          title="Record"
          facts={feature ? featureFacts(feature, resources) : biosampleFacts(sample as Biosample)}
        />
        <section className="rounded-xl border border-[#dce7ea] bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#829198]">
            Related matrices
          </p>
          <p className="mt-4 text-sm leading-6 text-[#71818a]">
            From the {kind} matrices endpoint
            {matrixTotal != null ? ` · ${matrixTotal.toLocaleString()} total` : ''}.
          </p>
          {matrices === null && !matrixError && (
            <p className="mt-4 text-sm text-[#71818a]">Loading related matrices…</p>
          )}
          {matrixError && (
            <p className="mt-4 text-sm text-[#a34c3b]">
              {matrixError}. Showing ids stored on the record.
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {matrices
              ? matrices.map((matrix) => (
                  <Link
                    key={matrix.matrixId}
                    href={matrixHref(matrix.matrixId, cohortQuery)}
                    className="rounded-md bg-[#f5faf9] px-3 py-2 text-sm text-[#0c6870] hover:bg-[#eaf4f2]"
                  >
                    <span className="block font-medium">{matrix.name ?? matrix.matrixId}</span>
                    <span className="font-mono text-[11px] text-[#829198]">{matrix.matrixId}</span>
                  </Link>
                ))
              : matrixError
                ? fallbackIds.map((id) => (
                    <Link
                      key={id}
                      href={matrixHref(id, cohortQuery)}
                      className="rounded-md bg-[#f5faf9] px-3 py-2 font-mono text-sm text-[#0c6870] hover:bg-[#eaf4f2]"
                    >
                      {id}
                    </Link>
                  ))
                : null}
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
