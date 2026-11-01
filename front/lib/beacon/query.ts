import type { BeaconFilter, Granularity, UiFilter } from './types'
import { needsPost, toBeaconFilter } from './filters'

export type QueryOptions = {
  filters?: UiFilter[]
  granularity?: Granularity
  skip?: number
  limit?: number
  search?: Record<string, string | number | undefined | null>
  signal?: AbortSignal
}

export function beaconRequestBody(opts: QueryOptions): {
  query: {
    requestedGranularity: Granularity
    pagination: { skip: number; limit: number }
    filters?: BeaconFilter[]
  }
} {
  const filters = (opts.filters ?? []).map(toBeaconFilter)
  return {
    query: {
      requestedGranularity: opts.granularity ?? 'record',
      pagination: { skip: opts.skip ?? 0, limit: opts.limit ?? 10 },
      ...(filters.length ? { filters } : {}),
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
  if (needsPost(opts.filters)) {
    return {
      method: 'POST',
      path: pathname,
      body: beaconRequestBody({ ...opts, granularity, skip, limit }),
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
