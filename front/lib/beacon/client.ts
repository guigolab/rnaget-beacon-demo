import { scopeOf, tokenToFilter } from './filters'
import { collectionQuery, type QueryOptions } from './query'
import type { MatrixQuery } from './filters'
import type {
  BeaconInfo,
  BeaconMeta,
  BeaconResult,
  Biosample,
  EntryTypeInfo,
  ExpressionValue,
  Feature,
  FilteringResource,
  FilteringTerm,
  Granularity,
  Matrix,
  UiFilter,
} from './types'
import { recordBeaconCall } from './recorder'
import { MAX_COHORT } from './types'

type ResultEnvelope<T> = {
  meta?: BeaconMeta
  responseSummary?: { exists?: boolean; numTotalResults?: number }
  response?: { resultSets?: Array<{ results?: T[] }> }
  error?: { errorMessage?: string }
}

type InfoEnvelope<T> = {
  response?: T
  error?: { errorMessage?: string }
}

export class BeaconError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (raw) return raw.replace(/\/$/, '')
  return '/rnaget-beacon/api'
}

function urlFor(path: string): string {
  return `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

async function beaconFetch(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(urlFor(path), {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    const message =
      (data as ResultEnvelope<unknown> | null)?.error?.errorMessage ??
      `Beacon request failed (${response.status}) for ${path}`
    throw new BeaconError(message, response.status)
  }
  let bodyForRecord: unknown
  if (init?.body) {
    try {
      bodyForRecord = JSON.parse(String(init.body))
    } catch {
      bodyForRecord = String(init.body).slice(0, 2000)
    }
  }
  recordBeaconCall({
    method: init?.method ?? 'GET',
    path,
    body: bodyForRecord,
    response: data,
  })
  return data
}

export function parseResultset<T>(data: unknown): BeaconResult<T> {
  const envelope = (data ?? {}) as ResultEnvelope<T>
  const results = envelope.response?.resultSets?.[0]?.results ?? []
  return {
    exists: envelope.responseSummary?.exists ?? results.length > 0,
    total: envelope.responseSummary?.numTotalResults,
    results,
    meta: envelope.meta ?? {},
    returnedGranularity: envelope.meta?.returnedGranularity,
  }
}

export async function queryCollection<T>(
  path: string,
  opts: QueryOptions = {}
): Promise<BeaconResult<T>> {
  const request = collectionQuery(path, opts)
  const data = await beaconFetch(request.path, {
    method: request.method,
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: opts.signal,
  })
  return parseResultset<T>(data)
}

export async function getInformational<T>(path: string): Promise<T> {
  const data = (await beaconFetch(path)) as InfoEnvelope<T>
  if (!data?.response) {
    throw new BeaconError(`Empty informational response for ${path}`, 500)
  }
  return data.response
}

export function getInfo(): Promise<BeaconInfo> {
  return getInformational<BeaconInfo>('/info')
}

export async function getEntryTypes(): Promise<Record<string, EntryTypeInfo>> {
  const body = await getInformational<{ entryTypes?: Record<string, EntryTypeInfo> }>(
    '/entry_types'
  )
  return body.entryTypes ?? {}
}

export type FilteringTermsResult = {
  terms: FilteringTerm[]
  resources: FilteringResource[]
}

const filteringTermsCache = new Map<string, FilteringTermsResult>()
const filteringTermsPending = new Map<string, Promise<FilteringTermsResult>>()

export function peekFilteringTerms(path = '/filtering_terms'): FilteringTermsResult | null {
  return filteringTermsCache.get(path) ?? null
}

export async function getFilteringTerms(path = '/filtering_terms'): Promise<FilteringTermsResult> {
  const cached = filteringTermsCache.get(path)
  if (cached) return cached
  const pending = filteringTermsPending.get(path)
  if (pending) return pending
  const request = getInformational<{
    filteringTerms?: FilteringTerm[]
    resources?: FilteringResource[]
  }>(path)
    .then((body) => {
      const result = {
        terms: body.filteringTerms ?? [],
        resources: body.resources ?? [],
      }
      filteringTermsCache.set(path, result)
      filteringTermsPending.delete(path)
      return result
    })
    .catch((err: unknown) => {
      filteringTermsPending.delete(path)
      throw err
    })
  filteringTermsPending.set(path, request)
  return request
}

export function listMatrices(
  skip = 0,
  limit = 20,
  opts?: { filters?: UiFilter[]; granularity?: Granularity }
) {
  return queryCollection<Matrix>('/matrices', {
    skip,
    limit,
    filters: opts?.filters,
    granularity: opts?.granularity ?? 'record',
  })
}

export type ExpressionSummary = {
  id: string
  matrixId: string
  featureId: string
  n: number
  mean?: number
  median?: number
  min?: number
  max?: number
  q1?: number
  q3?: number
  fractionAboveThreshold?: number
  minBiosampleId?: string
  maxBiosampleId?: string
  group?: { id: string; label: string }
}

export function listMatrixExpressionSummary(
  matrixId: string,
  params: {
    featureIDList: string
    groupBy?: string
    threshold?: number
    filters?: UiFilter[]
  }
) {
  return queryCollection<ExpressionSummary>(
    `/matrices/${encodeURIComponent(matrixId)}/expression_summary`,
    {
      granularity: 'record',
      limit: 500,
      filters: params.filters,
      requestParameters: {
        featureIDList: params.featureIDList,
        groupBy: params.groupBy,
        threshold: params.threshold,
      },
    }
  )
}

export async function getMatrix(id: string): Promise<Matrix | null> {
  const page = await queryCollection<Matrix>(
    `/matrices/${encodeURIComponent(id)}`,
    { granularity: 'record', limit: 1 }
  )
  return page.results[0] ?? null
}

export function listFeatures(
  skip = 0,
  limit = 20,
  opts?: { filters?: UiFilter[]; granularity?: Granularity }
) {
  return queryCollection<Feature>('/features', {
    skip,
    limit,
    filters: opts?.filters,
    granularity: opts?.granularity ?? 'record',
  })
}

export async function getFeature(
  id: string,
  signal?: AbortSignal
): Promise<Feature | null> {
  const page = await queryCollection<Feature>(
    `/features/${encodeURIComponent(id)}`,
    { granularity: 'record', limit: 1, signal }
  )
  return page.results[0] ?? null
}

export function listBiosamples(
  skip = 0,
  limit = 20,
  opts?: { filters?: UiFilter[]; granularity?: Granularity }
) {
  return queryCollection<Biosample>('/biosamples', {
    skip,
    limit,
    filters: opts?.filters,
    granularity: opts?.granularity ?? 'record',
  })
}

export async function getBiosample(
  id: string,
  signal?: AbortSignal
): Promise<Biosample | null> {
  const page = await queryCollection<Biosample>(
    `/biosamples/${encodeURIComponent(id)}`,
    { granularity: 'record', limit: 1, signal }
  )
  return page.results[0] ?? null
}

export function listMatrixFeatures(
  matrixId: string,
  skip = 0,
  limit = 20,
  axis?: { sort?: 'id' | 'expression.min' | 'expression.max'; order?: 'asc' | 'desc' },
  signal?: AbortSignal
) {
  return queryCollection<Feature>(`/matrices/${encodeURIComponent(matrixId)}/features`, {
    granularity: 'record',
    skip,
    limit,
    requestParameters: { sort: axis?.sort, order: axis?.order },
    signal,
  })
}

export function listMatrixBiosamples(
  matrixId: string,
  skip = 0,
  limit = 20,
  signal?: AbortSignal
) {
  return queryCollection<Biosample>(
    `/matrices/${encodeURIComponent(matrixId)}/biosamples`,
    { granularity: 'record', skip, limit, signal }
  )
}

export function listExpressionValues(
  matrixId: string,
  params: {
    skip?: number
    limit?: number
    featureIDList?: string
    biosampleIDList?: string
    minValue?: number
    maxValue?: number
    signal?: AbortSignal
  }
) {
  return queryCollection<ExpressionValue>(
    `/matrices/${encodeURIComponent(matrixId)}/expression_values`,
    {
      granularity: 'record',
      skip: params.skip ?? 0,
      limit: params.limit ?? 10,
      signal: params.signal,
      requestParameters: {
        featureIDList: params.featureIDList,
        biosampleIDList: params.biosampleIDList,
        minValue: params.minValue,
        maxValue: params.maxValue,
      },
    }
  )
}

export function listRelatedMatrices(
  kind: 'feature' | 'biosample',
  id: string,
  skip = 0,
  limit = 50
) {
  const root = kind === 'feature' ? 'features' : 'biosamples'
  return queryCollection<Matrix>(`/${root}/${encodeURIComponent(id)}/matrices`, {
    granularity: 'record',
    skip,
    limit,
  })
}

export type ResolvedCohort<T> = {
  items: T[]
  total: number
}

function remember(seen: Set<string>, feature: Feature) {
  seen.add(feature.id)
  const native = feature.genomicFeature?.featureIdentifier?.id
  if (native) seen.add(native)
}

function hasFeature(seen: Set<string>, token: string) {
  return seen.has(token)
}

function stubFeature(token: string): Feature {
  return {
    id: token,
    genomicFeature: { featureIdentifier: { id: token }, aliases: [token] },
  }
}

async function resolveToken(token: string, signal?: AbortSignal): Promise<Feature[]> {
  const filter = tokenToFilter(token, 'feature')
  if (filter) {
    const page = await queryCollection<Feature>('/features', {
      filters: [filter],
      granularity: 'record',
      skip: 0,
      limit: 5,
      signal,
    })
    if (page.results.length) return page.results
  }
  const direct = await getFeature(token, signal)
  if (direct) return [direct]
  return [stubFeature(token)]
}

export async function resolveFeatureCohort(
  query: Pick<MatrixQuery, 'filters' | 'featureIds' | 'genes'>,
  signal?: AbortSignal
): Promise<ResolvedCohort<Feature> | null> {
  const filters = query.filters.filter((filter) => scopeOf(filter) === 'feature')
  const extras = [...query.genes, ...query.featureIds]
  if (!filters.length && !extras.length) return null

  const items: Feature[] = []
  const seen = new Set<string>()
  let total = 0

  if (filters.length) {
    const page = await queryCollection<Feature>('/features', {
      filters,
      granularity: 'record',
      skip: 0,
      limit: MAX_COHORT,
      signal,
    })
    total = Math.max(total, page.total ?? page.results.length)
    for (const feature of page.results) {
      if (items.length >= MAX_COHORT) break
      remember(seen, feature)
      items.push(feature)
    }
  }

  const pendingGenes = query.genes
    .filter((token) => !hasFeature(seen, token))
    .slice(0, MAX_COHORT - items.length)
  const resolvedGenes = await mapPool(pendingGenes, 6, (token) => resolveToken(token, signal))
  for (const group of resolvedGenes) {
    for (const feature of group) {
      if (items.length >= MAX_COHORT) break
      if (hasFeature(seen, feature.id)) continue
      remember(seen, feature)
      items.push(feature)
    }
  }

  const pendingIds = query.featureIds
    .filter((token) => !hasFeature(seen, token))
    .slice(0, MAX_COHORT - items.length)
  const resolvedIds = await mapPool(pendingIds, 6, async (token) => {
    const feature = await getFeature(token, signal)
    return feature ?? stubFeature(token)
  })
  for (const feature of resolvedIds) {
    if (items.length >= MAX_COHORT) break
    if (hasFeature(seen, feature.id)) continue
    remember(seen, feature)
    items.push(feature)
  }
  if (!filters.length) total = items.length
  else total = Math.max(total, items.length)
  return { items, total }
}

export async function resolveBiosampleCohort(
  query: Pick<MatrixQuery, 'filters' | 'biosampleIds'>,
  signal?: AbortSignal
): Promise<ResolvedCohort<Biosample> | null> {
  const filters = query.filters.filter((filter) => scopeOf(filter) === 'biosample')
  if (!filters.length && !query.biosampleIds.length) return null

  const items: Biosample[] = []
  const seen = new Set<string>()
  let total = 0

  if (filters.length) {
    const page = await queryCollection<Biosample>('/biosamples', {
      filters,
      granularity: 'record',
      skip: 0,
      limit: MAX_COHORT,
      signal,
    })
    total = page.total ?? page.results.length
    for (const sample of page.results) {
      if (items.length >= MAX_COHORT) break
      seen.add(sample.id)
      items.push(sample)
    }
  }

  const pendingIds = query.biosampleIds
    .filter((id) => !seen.has(id))
    .slice(0, MAX_COHORT - items.length)
  const resolved = await mapPool(pendingIds, 6, async (id) => {
    const sample = await getBiosample(id, signal)
    return sample ?? ({ id } satisfies Biosample)
  })
  for (const sample of resolved) {
    if (items.length >= MAX_COHORT) break
    if (seen.has(sample.id)) continue
    seen.add(sample.id)
    items.push(sample)
  }
  if (!filters.length) total = items.length
  return { items, total }
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index] as T)
    }
  }
  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
