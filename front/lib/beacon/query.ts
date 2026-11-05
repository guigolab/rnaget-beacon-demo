import type { BeaconFilter, Granularity, UiFilter } from './types'
import { needsPost, toBeaconFilter } from './filters'

/** Matches server `BeaconRequestParameters` under `query.requestParameters`. */
export type RequestParameters = {
  featureIDList?: string
  biosampleIDList?: string
  matrixIDList?: string
  minValue?: number
  maxValue?: number
  /** expression_values only: order by cell value. */
  order?: string
  [key: string]: string | number | boolean | string[] | undefined | null
}

export type QueryOptions = {
  filters?: UiFilter[]
  granularity?: Granularity
  skip?: number
  limit?: number
  /** Opaque keyset token; sent as query.pagination.nextPage (forces POST). */
  pageToken?: string
  search?: Record<string, string | number | undefined | null>
  requestParameters?: RequestParameters
  signal?: AbortSignal
}

function cleanRequestParameters(
  raw?: RequestParameters
): Record<string, string | number | boolean | string[]> | undefined {
  if (!raw) return undefined
  const out: Record<string, string | number | boolean | string[]> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

export function beaconRequestBody(opts: QueryOptions): {
  query: {
    requestedGranularity: Granularity
    pagination: {
      skip: number
      limit: number
      nextPage?: string
    }
    filters?: BeaconFilter[]
    requestParameters?: Record<string, string | number | boolean | string[]>
  }
} {
  const filters = (opts.filters ?? []).map(toBeaconFilter)
  const requestParameters = cleanRequestParameters(opts.requestParameters)
  const pageToken = opts.pageToken?.trim()
  return {
    query: {
      requestedGranularity: opts.granularity ?? 'record',
      pagination: {
        skip: pageToken ? 0 : (opts.skip ?? 0),
        limit: opts.limit ?? 10,
        ...(pageToken ? { nextPage: pageToken } : {}),
      },
      ...(filters.length ? { filters } : {}),
      ...(requestParameters ? { requestParameters } : {}),
    },
  }
}

export function withQuery(
  path: string,
  params: Record<string, string | number | undefined | null>
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  const base = path.startsWith('/') ? path : `/${path}`
  return qs ? `${base}?${qs}` : base
}

export function collectionQuery(path: string, opts: QueryOptions): {
  method: 'GET' | 'POST'
  path: string
  body?: ReturnType<typeof beaconRequestBody>
} {
  const granularity = opts.granularity ?? 'record'
  const skip = opts.skip ?? 0
  const limit = opts.limit ?? 10
  const pathname = path.split('?')[0] || path
  const requestParameters = cleanRequestParameters(opts.requestParameters)
  const pageToken = opts.pageToken?.trim()
  const usePost =
    needsPost(opts.filters) || Boolean(requestParameters) || Boolean(pageToken)
  if (usePost) {
    return {
      method: 'POST',
      path: pathname,
      body: beaconRequestBody({
        ...opts,
        granularity,
        skip,
        limit,
        requestParameters,
        pageToken,
      }),
    }
  }
  const ids = (opts.filters ?? [])
    .map(toBeaconFilter)
    .map((filter) => filter.id)
    .filter(Boolean)
  return {
    method: 'GET',
    path: withQuery(pathname, {
      ...opts.search,
      skip,
      limit,
      requestedGranularity: granularity,
      filters: ids.length ? ids.join(',') : undefined,
    }),
  }
}
