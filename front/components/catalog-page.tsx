'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BeaconReceipt } from '@/components/beacon-receipt'
import { EntityBrowser } from '@/components/entity-browser'
import { FilterBuilder } from '@/components/filter-builder'
import { GranularityLadder } from '@/components/granularity-ladder'
import { EmptyState, EndpointNote, PageFrame, PageHeader, Pagination } from '@/components/ui-kit'
import { useBeaconQuery } from '@/hooks/use-beacon-query'
import {
  catalogSearchParams,
  parseCatalogSearch,
  scopeOf,
  type Biosample,
  type Feature,
  type Granularity,
  type UiFilter,
} from '@/lib/beacon'

const LIMIT = 20

export function CatalogPage({
  scope,
  path,
  base,
  eyebrow,
  title,
  description,
  endpoint,
  kind,
}: {
  scope: 'feature' | 'biosample'
  path: '/features' | '/biosamples'
  base: string
  eyebrow: string
  title: string
  description: string
  endpoint: string
  kind: 'features' | 'biosamples'
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const parsed = useMemo(() => parseCatalogSearch(searchParams), [searchParams])
  const filters = parsed.filters.filter((filter) => scopeOf(filter) === scope)
  const granularity: Granularity =
    parsed.granularity ?? (filters.length ? 'boolean' : 'record')
  const skip = granularity === 'record' ? parsed.skip : 0
  const { result, error, loading } = useBeaconQuery<Feature | Biosample>(path, {
    filters,
    granularity,
    skip,
    limit: LIMIT,
  })

  function write(next: { filters?: UiFilter[]; granularity?: Granularity; skip?: number }) {
    const params = catalogSearchParams({
      filters: next.filters ?? filters,
      granularity: next.granularity ?? granularity,
      skip: next.skip ?? 0,
      limit: LIMIT,
    })
    const qs = params.toString()
    router.replace(qs ? `${base}?${qs}` : base)
  }

  const exists = result?.exists
  const total = result?.total

  return (
    <PageFrame>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EndpointNote>{endpoint}</EndpointNote>
      <div className="mt-6">
        <FilterBuilder
          scope={scope}
          filters={filters}
          onChange={(next) =>
            write({
              filters: next,
              granularity: next.length ? 'boolean' : 'record',
              skip: 0,
            })
          }
        />
      </div>
      <div className="mt-6">
        <GranularityLadder
          value={granularity}
          exists={loading ? undefined : exists}
          total={loading ? undefined : total}
          locked={!loading && exists === false}
          onChange={(next) => write({ granularity: next, skip: 0 })}
        />
      </div>
      {(result && (!loading || result.returnedGranularity === granularity)) && (
        <div className="mt-6">
          <BeaconReceipt meta={result.meta} />
        </div>
      )}
      {error && (
        <p className="mt-6 rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">{error}</p>
      )}
      {loading && !result && <p className="mt-6 text-sm text-[#71818a]">Querying beacon…</p>}
      {!loading && granularity === 'boolean' && result && (
        <p className="mt-6 text-sm text-[#52666f]">
          {result.exists
            ? 'Matches exist. Ask for a count, or open the records.'
            : 'No records match these filters.'}
        </p>
      )}
      {!loading && granularity === 'count' && result && (
        <p className="mt-6 text-sm text-[#52666f]">
          {result.exists
            ? `${(result.total ?? 0).toLocaleString()} records match. Open them when you want the rows.`
            : 'No records match these filters.'}
        </p>
      )}
      {!loading && granularity === 'record' && result?.returnedGranularity === 'record' && result.results.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No records"
            description="This page is empty for the current filters. Adjust the query or go back a page."
          />
        </div>
      )}
      {granularity === 'record' && result?.returnedGranularity === 'record' && result.results.length > 0 && (
        <div className={loading ? 'mt-6 opacity-60' : 'mt-6'}>
          <EntityBrowser kind={kind} items={result.results} />
          <Pagination
            skip={skip}
            limit={LIMIT}
            total={result.total ?? result.results.length}
            href={(nextSkip) => {
                const params = catalogSearchParams({
                  filters,
                  granularity,
                  skip: nextSkip,
                  limit: LIMIT,
                })
              return `${base}?${params}`
            }}
          />
        </div>
      )}
    </PageFrame>
  )
}
