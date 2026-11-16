import type { BeaconFilter, Granularity, UiFilter } from './types'
import { needsPost, toBeaconFilter } from './filters'

/** Leaf params under query.requestParameters.expressionValue. */
export type ExpressionValueRequestParameters = {
  featureIDList?: string
  biosampleIDList?: string
  minValue?: number
  maxValue?: number
  /** expression_values only: order by cell value (server default: desc). */
  order?: string
}

/**
 * Matches server `BeaconRequestParameters` under `query.requestParameters`
 * (beacon-v2 matrices/requestParameters.yaml). Only `expressionValue` is
 * defined; features, biosamples and matrices define no request parameters.
 * The Beacon framework requires each entry to be an object keyed by entry type.
 */
export type RequestParameters = {
  expressionValue?: ExpressionValueRequestParameters
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
  /** Fold consecutive calls with this group into one API-drawer entry. */
  recordGroup?: string
}

function cleanLeaves(
  raw?: Record<string, string | number | boolean | string[] | undefined | null>
): Record<string, string | number | boolean | string[]> | undefined {
  if (!raw) return undefined
  const out: Record<string, string | number | boolean | string[]> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

function cleanRequestParameters(
  raw?: RequestParameters
): RequestParameters | undefined {
  if (!raw) return undefined
  const out: RequestParameters = {}
  const expressionValue = cleanLeaves(raw.expressionValue)
  if (expressionValue) out.expressionValue = expressionValue
  return Object.keys(out).length ? out : undefined
}

/** Flatten nested requestParameters for GET query-string aliases. */
export function flattenRequestParameters(
  raw?: RequestParameters
): Record<string, string | number | boolean | string[]> | undefined {
  const nested = cleanRequestParameters(raw)
  if (!nested) return undefined
  const out: Record<string, string | number | boolean | string[]> = {}
  for (const entity of Object.values(nested)) {
    if (!entity) continue
    for (const [key, value] of Object.entries(entity)) {
      if (value === undefined || value === null || value === '') continue
      out[key] = value
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** Matches server `BeaconRequestMeta.apiVersion` / `BEACON_API_VERSION` default. */
export const BEACON_API_VERSION = 'v2.0.0'

export function beaconRequestBody(opts: QueryOptions): {
  meta: { apiVersion: string }
  query: {
    requestedGranularity: Granularity
    pagination: {
      skip: number
      limit: number
      nextPage?: string
    }
    filters?: BeaconFilter[]
    requestParameters?: RequestParameters
  }
} {
  const filters = (opts.filters ?? []).map(toBeaconFilter)
  const requestParameters = cleanRequestParameters(opts.requestParameters)
  const pageToken = opts.pageToken?.trim()
  return {
    meta: { apiVersion: BEACON_API_VERSION },
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

/** Prefer GET when the query string stays under this length (nginx/proxy safe). */

export function collectionQuery(path: string, opts: QueryOptions): {
  method: 'GET' | 'POST'
  path: string
  body?: ReturnType<typeof beaconRequestBody>
} {
  const granularity = opts.granularity ?? 'record'
  const skip = opts.skip ?? 0
  // The API treats limit=0 as "unbounded" and ships every record even for
  // count/boolean (measured: 844 KB vs 1.2 KB at limit=1), so never send 0.
  const rawLimit = opts.limit ?? 10
  const limit = granularity !== 'record' && rawLimit < 1 ? 1 : rawLimit
  const pathname = path.split('?')[0] || path
  const requestParameters = cleanRequestParameters(opts.requestParameters)
  const pageToken = opts.pageToken?.trim()
  const filterIds = (opts.filters ?? [])
    .map(toBeaconFilter)
    .map((filter) => filter.id)
    .filter(Boolean)

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
  return {
    method: 'GET',
    path: withQuery(pathname, {
      ...opts.search,
      skip,
      limit,
      requestedGranularity: granularity,
      filters: filterIds.length ? filterIds.join(',') : undefined,
    }),
  }
}
