import { needsPost, scopeOf, tokenToFilter } from './filters'
import { collectionQuery, type QueryOptions } from './query'
import type { MatrixQuery } from './filters'
import type {
  BeaconConfiguration,
  BeaconInfo,
  BeaconMap,
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
  ServiceInfo,
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

function extractNextPage(data: unknown, meta: BeaconMeta): string | undefined {
  // Prefer Beacon receivedRequestSummary.pagination (PageToken); do not use
  // response-envelope info (info.axes / info.nextPage are not part of RNAget).
  const fromReceived = meta.receivedRequestSummary?.pagination?.nextPage
  if (typeof fromReceived === 'string' && fromReceived.trim()) {
    return fromReceived.trim()
  }
  const envelope = (data ?? {}) as {
    response?: { pagination?: { nextPage?: unknown } }
    meta?: BeaconMeta
  }
  const candidates = [
    envelope.response?.pagination?.nextPage,
    envelope.meta?.receivedRequestSummary?.pagination?.nextPage,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function parseResultset<T>(data: unknown): BeaconResult<T> {
  const envelope = (data ?? {}) as ResultEnvelope<T>
  const results = envelope.response?.resultSets?.[0]?.results ?? []
  const meta = envelope.meta ?? {}
  return {
    exists: envelope.responseSummary?.exists ?? results.length > 0,
    total: envelope.responseSummary?.numTotalResults,
    results,
    meta,
    returnedGranularity: meta.returnedGranularity,
    nextPage: extractNextPage(data, meta),
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

async function getInformational<T>(path: string): Promise<T> {
  const data = (await beaconFetch(path)) as InfoEnvelope<T>
  if (!data?.response) {
    throw new BeaconError(`Empty informational response for ${path}`, 500)
  }
  return data.response
}

export function getInfo(): Promise<BeaconInfo> {
  return getInformational<BeaconInfo>('/info')
}

export async function getServiceInfo(): Promise<ServiceInfo> {
  return (await beaconFetch('/service-info')) as ServiceInfo
}

export async function getEntryTypes(): Promise<Record<string, EntryTypeInfo>> {
  const body = await getInformational<{ entryTypes?: Record<string, EntryTypeInfo> }>(
    '/entry_types'
  )
  return body.entryTypes ?? {}
}

export function getBeaconMap(): Promise<BeaconMap> {
  return getInformational<BeaconMap>('/map')
}

export function getBeaconConfiguration(): Promise<BeaconConfiguration> {
  return getInformational<BeaconConfiguration>('/configuration')
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
  opts?: { filters?: UiFilter[]; granularity?: Granularity; signal?: AbortSignal }
) {
  return queryCollection<Matrix>('/matrices', {
    skip,
    limit,
    filters: opts?.filters,
    granularity: opts?.granularity ?? 'record',
    signal: opts?.signal,
  })
}

export async function getMatrix(id: string, signal?: AbortSignal): Promise<Matrix | null> {
  const page = await queryCollection<Matrix>(
    `/matrices/${encodeURIComponent(id)}`,
    { granularity: 'record', limit: 1, signal }
  )
  return page.results[0] ?? null
}

export function listFeatures(
  skip = 0,
  limit = 20,
  opts?: {
    filters?: UiFilter[]
    featureIDList?: string
    granularity?: Granularity
    signal?: AbortSignal
  }
) {
  const featureIDList = opts?.featureIDList?.trim()
  return queryCollection<Feature>('/features', {
    skip,
    limit,
    filters: opts?.filters,
    granularity: opts?.granularity ?? 'record',
    signal: opts?.signal,
    ...(featureIDList ? { requestParameters: { featureIDList } } : {}),
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
  opts?: { filters?: UiFilter[]; granularity?: Granularity; signal?: AbortSignal }
) {
  return queryCollection<Biosample>('/biosamples', {
    skip,
    limit,
    filters: opts?.filters,
    granularity: opts?.granularity ?? 'record',
    signal: opts?.signal,
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

/** Paging options for nested `/matrices/{id}/features` or `/biosamples`. */
export type MatrixAxisPageOpts = {
  filters?: UiFilter[]
  /** Features listing only. */
  featureIDList?: string
  /** Biosamples listing only. */
  biosampleIDList?: string
  /** Defaults to `record`. Use `boolean` / `count` for presence or totals without rows. */
  granularity?: Granularity
  signal?: AbortSignal
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value != null &&
    'aborted' in value &&
    typeof (value as AbortSignal).aborted === 'boolean'
  )
}

/** Accept the historical `(axis, signal)` and `(signal)` call shapes. */
export function normalizeMatrixAxisOpts(
  axisOrSignal?: MatrixAxisPageOpts | AbortSignal,
  signal?: AbortSignal
): MatrixAxisPageOpts {
  if (isAbortSignal(axisOrSignal)) return { signal: axisOrSignal }
  return { ...axisOrSignal, signal: signal ?? axisOrSignal?.signal }
}

function listMatrixAxis<T>(
  path: string,
  skip: number,
  limit: number,
  opts: MatrixAxisPageOpts,
  idListKey: 'featureIDList' | 'biosampleIDList'
) {
  const idList = opts[idListKey]
  const hasIdList = Boolean(idList?.trim())
  const post = needsPost(opts.filters) || hasIdList
  return queryCollection<T>(path, {
    granularity: opts.granularity ?? 'record',
    skip,
    limit,
    filters: opts.filters,
    signal: opts.signal,
    ...(post
      ? {
          requestParameters: {
            [idListKey]: idList,
          },
        }
      : {}),
  })
}

export function listMatrixFeatures(
  matrixId: string,
  skip = 0,
  limit = 20,
  axisOrSignal?: MatrixAxisPageOpts | AbortSignal,
  signal?: AbortSignal
) {
  return listMatrixAxis<Feature>(
    `/matrices/${encodeURIComponent(matrixId)}/features`,
    skip,
    limit,
    normalizeMatrixAxisOpts(axisOrSignal, signal),
    'featureIDList'
  )
}

export function listMatrixBiosamples(
  matrixId: string,
  skip = 0,
  limit = 20,
  axisOrSignal?: MatrixAxisPageOpts | AbortSignal,
  signal?: AbortSignal
) {
  return listMatrixAxis<Biosample>(
    `/matrices/${encodeURIComponent(matrixId)}/biosamples`,
    skip,
    limit,
    normalizeMatrixAxisOpts(axisOrSignal, signal),
    'biosampleIDList'
  )
}

/** Presence (`boolean`) or total (`count`) without returning biosample records. */
export function probeMatrixBiosamples(
  matrixId: string,
  opts: {
    filters?: UiFilter[]
    granularity: Exclude<Granularity, 'record'>
    signal?: AbortSignal
  }
) {
  return listMatrixBiosamples(matrixId, 0, 0, {
    filters: opts.filters,
    granularity: opts.granularity,
    signal: opts.signal,
  })
}

export type ExpressionValueOrder = 'asc' | 'desc'

export type RelatedMatricesOpts = {
  filters?: UiFilter[]
  matrixIDList?: string
  skip?: number
  limit?: number
  granularity?: Granularity
  signal?: AbortSignal
}

export function listFeatureMatrices(featureId: string, opts: RelatedMatricesOpts = {}) {
  const hasIdList = Boolean(opts.matrixIDList?.trim())
  const post = needsPost(opts.filters) || hasIdList
  return queryCollection<Matrix>(
    `/features/${encodeURIComponent(featureId)}/matrices`,
    {
      granularity: opts.granularity ?? 'record',
      skip: opts.skip ?? 0,
      limit: opts.limit ?? 50,
      filters: opts.filters,
      signal: opts.signal,
      ...(post
        ? {
            requestParameters: {
              matrixIDList: opts.matrixIDList,
            },
          }
        : {}),
    }
  )
}

export function listBiosampleMatrices(biosampleId: string, opts: RelatedMatricesOpts = {}) {
  const hasIdList = Boolean(opts.matrixIDList?.trim())
  const post = needsPost(opts.filters) || hasIdList
  return queryCollection<Matrix>(
    `/biosamples/${encodeURIComponent(biosampleId)}/matrices`,
    {
      granularity: opts.granularity ?? 'record',
      skip: opts.skip ?? 0,
      limit: opts.limit ?? 50,
      filters: opts.filters,
      signal: opts.signal,
      ...(post
        ? {
            requestParameters: {
              matrixIDList: opts.matrixIDList,
            },
          }
        : {}),
    }
  )
}

export function listExpressionValues(
  matrixId: string,
  params: {
    skip?: number
    limit?: number
    pageToken?: string
    featureIDList?: string
    biosampleIDList?: string
    minValue?: number
    maxValue?: number
    /** Sort direction for cell quantification (always by value). */
    order?: ExpressionValueOrder
    filters?: UiFilter[]
    granularity?: Granularity
    signal?: AbortSignal
  }
) {
  const filters = (params.filters ?? []).filter((filter) => {
    const scope = scopeOf(filter)
    return (
      scope === 'biosample' ||
      scope === 'feature' ||
      scope === 'expressionValue'
    )
  })
  const hasIdList = Boolean(params.featureIDList || params.biosampleIDList)
  const hasRange = params.minValue != null || params.maxValue != null
  const hasOrder = Boolean(params.order)
  const post =
    needsPost(filters) ||
    hasIdList ||
    hasRange ||
    hasOrder ||
    Boolean(params.pageToken?.trim())
  return queryCollection<ExpressionValue>(
    `/matrices/${encodeURIComponent(matrixId)}/expression_values`,
    {
      granularity: params.granularity ?? 'record',
      skip: params.skip ?? 0,
      limit: params.limit ?? 10,
      pageToken: params.pageToken,
      filters: filters.length ? filters : undefined,
      signal: params.signal,
      ...(post
        ? {
            requestParameters: {
              featureIDList: params.featureIDList,
              biosampleIDList: params.biosampleIDList,
              minValue: params.minValue,
              maxValue: params.maxValue,
              order: params.order,
            },
          }
        : {
            search: {
              order: params.order,
            },
          }),
    }
  )
}

/**
 * Walk expression_values pages using `nextPage` tokens when present,
 * falling back to skip/limit offset pagination.
 */
export async function* iterateExpressionValues(
  matrixId: string,
  params: {
    limit?: number
    featureIDList?: string
    biosampleIDList?: string
    minValue?: number
    maxValue?: number
    order?: ExpressionValueOrder
    filters?: UiFilter[]
    granularity?: Granularity
    signal?: AbortSignal
  } = {}
): AsyncGenerator<ExpressionValue[], void, undefined> {
  const limit = params.limit ?? 100
  let pageToken: string | undefined
  let skip = 0
  for (;;) {
    if (params.signal?.aborted) return
    const page = await listExpressionValues(matrixId, {
      ...params,
      limit,
      skip: pageToken ? 0 : skip,
      pageToken,
    })
    if (!page.results.length) return
    yield page.results
    if (page.nextPage) {
      pageToken = page.nextPage
      continue
    }
    pageToken = undefined
    skip += page.results.length
    if (page.total != null && skip >= page.total) return
    if (page.results.length < limit) return
  }
}

export function listRelatedMatrices(
  kind: 'feature' | 'biosample',
  id: string,
  skip = 0,
  limit = 50
) {
  if (kind === 'feature') {
    return listFeatureMatrices(id, { skip, limit })
  }
  return listBiosampleMatrices(id, { skip, limit })
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

export function featuresInMatrix(
  matrixId: string,
  cohort: ResolvedCohort<Feature>
): ResolvedCohort<Feature> {
  const items = cohort.items.filter((feature) => {
    const mids = feature.matrixIds
    if (!mids?.length) return true
    return mids.includes(matrixId)
  })
  const total =
    items.length === cohort.items.length ? cohort.total : Math.max(items.length, 0)
  return { items, total }
}

async function matrixBiosampleCatalog(
  matrixId: string,
  signal?: AbortSignal
): Promise<Map<string, Biosample>> {
  const path = `/matrices/${encodeURIComponent(matrixId)}/biosamples`
  const page = await queryCollection<Biosample>(path, {
    granularity: 'record',
    skip: 0,
    limit: MAX_COHORT,
    signal,
  })
  return new Map(page.results.map((sample) => [sample.id, sample]))
}

export async function resolveMatrixBiosampleCohort(
  matrixId: string,
  query: Pick<MatrixQuery, 'filters' | 'biosampleIds'>,
  signal?: AbortSignal
): Promise<ResolvedCohort<Biosample> | null> {
  const filters = query.filters.filter((filter) => scopeOf(filter) === 'biosample')
  if (!filters.length && !query.biosampleIds.length) return null

  const items: Biosample[] = []
  const seen = new Set<string>()
  let total = 0
  const path = `/matrices/${encodeURIComponent(matrixId)}/biosamples`

  if (filters.length) {
    const page = await queryCollection<Biosample>(path, {
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

  if (pendingIds.length) {
    const catalog = await matrixBiosampleCatalog(matrixId, signal)
    const stillMissing: string[] = []
    for (const id of pendingIds) {
      if (items.length >= MAX_COHORT) break
      const fromMatrix = catalog.get(id)
      if (fromMatrix) {
        seen.add(id)
        items.push(fromMatrix)
      } else {
        stillMissing.push(id)
      }
    }
    if (stillMissing.length) {
      const resolved = await mapPool(stillMissing, 6, async (id) => {
        const sample = await getBiosample(id, signal)
        return sample ?? ({ id } satisfies Biosample)
      })
      for (const sample of resolved) {
        if (items.length >= MAX_COHORT) break
        if (seen.has(sample.id)) continue
        seen.add(sample.id)
        items.push(sample)
      }
    }
  }

  if (!filters.length) total = items.length
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
