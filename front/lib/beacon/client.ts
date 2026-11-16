import { filterKey, scopeOf, symbolFilter, tokenToFilter } from './filters'
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
  UiFilter} from './types'
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

async function beaconFetch(
  path: string,
  init?: RequestInit,
  opts?: { group?: string }
): Promise<unknown> {
  const response = await fetch(urlFor(path), {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers}})
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
    group: opts?.group})
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
    nextPage: extractNextPage(data, meta)}
}

export async function queryCollection<T>(
  path: string,
  opts: QueryOptions = {}
): Promise<BeaconResult<T>> {
  const request = collectionQuery(path, opts)
  const data = await beaconFetch(
    request.path,
    {
      method: request.method,
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: opts.signal},
    { group: opts.recordGroup }
  )
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
        resources: body.resources ?? []}
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
    signal: opts?.signal})
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
    granularity?: Granularity
    signal?: AbortSignal
    recordGroup?: string
  }
) {
  return queryCollection<Feature>('/features', {
    skip,
    limit,
    filters: opts?.filters,
    granularity: opts?.granularity ?? 'record',
    signal: opts?.signal,
    recordGroup: opts?.recordGroup})
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
    signal: opts?.signal})
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
  /** Defaults to `record`. Use `boolean` / `count` for presence or totals without rows. */
  granularity?: Granularity
  /**
   * Filtered lists only: stop scanning the collection root once this many rows
   * belong to the matrix. `total` is then a lower bound, not the full count.
   */
  maxResults?: number
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

/** Page size and cap for client-side resolution through collection roots. */
const ROOT_PAGE = 1000
/** Covers the whole demo package (≈103k root features); a safety stop only. */
const ROOT_CAP = 150000

function splitTokens(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Module-level memo (package is immutable); evicts oldest entries. */
const resolveMemo = new Map<string, Promise<unknown>>()
const RESOLVE_MEMO_MAX = 512

function memoResolve<T>(key: string, build: () => Promise<T>): Promise<T> {
  const hit = resolveMemo.get(key) as Promise<T> | undefined
  if (hit) {
    resolveMemo.delete(key)
    resolveMemo.set(key, hit)
    return hit
  }
  const pending = build().catch((err: unknown) => {
    resolveMemo.delete(key)
    throw err
  })
  resolveMemo.set(key, pending)
  while (resolveMemo.size > RESOLVE_MEMO_MAX) {
    const oldest = resolveMemo.keys().next().value
    if (oldest == null) break
    resolveMemo.delete(oldest)
  }
  return pending
}

export function resetBeaconResolveCaches() {
  resolveMemo.clear()
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
}

/**
 * Every record matching `filters` at a collection root (filters belong on
 * roots only), paged and capped. Rows are optionally narrowed to one matrix
 * through their `matrixIds`.
 */
async function collectRootRecords<T extends { matrixIds?: string[] }>(
  collectionPath: '/features' | '/biosamples' | '/matrices',
  filters: UiFilter[],
  matrixId?: string,
  maxResults?: number
): Promise<T[]> {
  if (matrixId && maxResults != null && maxResults > 0) {
    // First slice only: stream root pages and stop once enough rows are in the matrix.
    return memoResolve<T[]>(
      JSON.stringify([
        'root-first',
        collectionPath,
        matrixId,
        maxResults,
        filters.map((f) => filterKey(f)),
      ]),
      async () => {
        const out: T[] = []
        for (let skip = 0; skip < ROOT_CAP; skip += ROOT_PAGE) {
          const page = await queryCollection<T>(collectionPath, {
            filters,
            granularity: 'record',
            skip,
            limit: ROOT_PAGE,
          })
          for (const row of page.results) {
            if (!row.matrixIds || row.matrixIds.includes(matrixId)) out.push(row)
            if (out.length >= maxResults) return out
          }
          const total = page.total ?? 0
          if (!page.results.length || skip + page.results.length >= total) break
        }
        return out
      }
    )
  }
  // The unnarrowed root result is shared by every matrix (memoised).
  const all = await memoResolve<T[]>(
    JSON.stringify(['root', collectionPath, filters.map((f) => filterKey(f))]),
    async () => {
      const out: T[] = []
      for (let skip = 0; skip < ROOT_CAP; skip += ROOT_PAGE) {
        const page = await queryCollection<T>(collectionPath, {
          filters,
          granularity: 'record',
          skip,
          limit: ROOT_PAGE,
        })
        out.push(...page.results)
        const total = page.total ?? 0
        if (!page.results.length || skip + page.results.length >= total) break
      }
      return out
    }
  )
  if (!matrixId) return all
  return all.filter((row) => !row.matrixIds || row.matrixIds.includes(matrixId))
}

function featureTokens(feature: Feature): string[] {
  return [
    feature.id,
    feature.featureIdentifier?.id ?? '',
    ...(feature.aliases ?? []),
  ].filter(Boolean)
}

/**
 * Look one token up by id, native accession or symbol. A symbol can match
 * one record per annotation namespace (for example NCBI Gene and GENCODE).
 */
function lookupFeatureToken(token: string): Promise<Feature[]> {
  // Axis growth re-resolves the same ids; the package is immutable, so memoise.
  return memoResolve(JSON.stringify(['feature-token', token]), () =>
    lookupFeatureTokenUncached(token)
  )
}

async function lookupFeatureTokenUncached(token: string): Promise<Feature[]> {
  const direct = await getFeature(token)
  if (direct) return [direct]
  // Plain tokens are gene symbols (exact case); accessions/CURIEs map to filters.
  const filter = tokenToFilter(token, 'feature') ?? symbolFilter(token)
  const page = await queryCollection<Feature>('/features', {
    filters: [filter],
    granularity: 'record',
    skip: 0,
    limit: 10,
  })
  return page.results
}

async function resolveMatrixFeatures(
  matrixId: string,
  filters: UiFilter[] | undefined,
  rawTokens: readonly string[],
  maxResults?: number
): Promise<Feature[]> {
  const tokens = rawTokens.map((t) => t.trim()).filter(Boolean).slice(0, MAX_COHORT)
  const filtered = filters?.length
    ? await collectRootRecords<Feature>(
        '/features',
        filters,
        matrixId,
        tokens.length ? undefined : maxResults
      )
    : null
  if (!tokens.length) return filtered ?? []
  if (filtered) {
    const byToken = new Map<string, Feature>()
    for (const feature of filtered) {
      for (const t of featureTokens(feature)) {
        if (!byToken.has(t)) byToken.set(t, feature)
      }
    }
    const seen = new Set<string>()
    const out: Feature[] = []
    for (const token of tokens) {
      const feature = byToken.get(token)
      if (feature && !seen.has(feature.id)) {
        seen.add(feature.id)
        out.push(feature)
      }
    }
    return out
  }
  const found = await mapPool(tokens, 6, async (token) => {
    try {
      return await lookupFeatureToken(token)
    } catch {
      return [] as Feature[]
    }
  })
  const seen = new Set<string>()
  const out: Feature[] = []
  for (const feature of found.flat()) {
    if (seen.has(feature.id)) continue
    if (feature.matrixIds && !feature.matrixIds.includes(matrixId)) continue
    seen.add(feature.id)
    out.push(feature)
  }
  return out
}

async function resolveMatrixBiosamples(
  matrixId: string,
  filters: UiFilter[] | undefined,
  rawTokens: readonly string[],
  maxResults?: number
): Promise<Biosample[]> {
  const tokens = rawTokens.map((t) => t.trim()).filter(Boolean).slice(0, MAX_COHORT)
  const filtered = filters?.length
    ? await collectRootRecords<Biosample>(
        '/biosamples',
        filters,
        matrixId,
        tokens.length ? undefined : maxResults
      )
    : null
  if (!tokens.length) return filtered ?? []
  if (filtered) {
    const byId = new Map(filtered.map((sample) => [sample.id, sample]))
    return tokens
      .map((token) => byId.get(token))
      .filter((sample): sample is Biosample => Boolean(sample))
  }
  const found = await mapPool(tokens, 6, async (token) => {
    try {
      return await memoResolve(JSON.stringify(['biosample-token', token]), () =>
        getBiosample(token)
      )
    } catch {
      return null
    }
  })
  return found.filter(
    (sample): sample is Biosample =>
      Boolean(sample) &&
      (!sample!.matrixIds || sample!.matrixIds.includes(matrixId))
  )
}

function pagedResult<T>(
  all: T[],
  skip: number,
  limit: number,
  granularity: Granularity
): BeaconResult<T> {
  const rows = granularity === 'record' ? all.slice(skip, skip + (limit || ROOT_PAGE)) : []
  return {
    exists: all.length > 0,
    total: all.length,
    results: rows,
    meta: {},
    returnedGranularity: granularity,
  }
}

/**
 * Nested `/matrices/{id}/features|biosamples` define no filters or request
 * parameters. Constrained lists are resolved here: filters at the collection
 * root, ID lists by record lookup, both narrowed to this matrix via `matrixIds`.
 */
async function listMatrixAxis<T>(
  kind: 'features' | 'biosamples',
  matrixId: string,
  skip: number,
  limit: number,
  opts: MatrixAxisPageOpts
): Promise<BeaconResult<T>> {
  const granularity = opts.granularity ?? 'record'
  const filters = opts.filters?.length ? opts.filters : undefined
  if (!filters) {
    return queryCollection<T>(`/matrices/${encodeURIComponent(matrixId)}/${kind}`, {
      granularity,
      skip,
      limit,
      signal: opts.signal})
  }
  const key = JSON.stringify([
    kind,
    matrixId,
    (filters ?? []).map((f) => filterKey(f)),
    opts.maxResults ?? 0,
  ])
  const all = await memoResolve<unknown[]>(key, () =>
    kind === 'features'
      ? resolveMatrixFeatures(matrixId, filters, [], opts.maxResults)
      : resolveMatrixBiosamples(matrixId, filters, [], opts.maxResults)
  )
  throwIfAborted(opts.signal)
  return pagedResult(all as T[], skip, limit, granularity)
}

export function listMatrixFeatures(
  matrixId: string,
  skip = 0,
  limit = 20,
  axisOrSignal?: MatrixAxisPageOpts | AbortSignal,
  signal?: AbortSignal
) {
  return listMatrixAxis<Feature>(
    'features',
    matrixId,
    skip,
    limit,
    normalizeMatrixAxisOpts(axisOrSignal, signal)
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
    'biosamples',
    matrixId,
    skip,
    limit,
    normalizeMatrixAxisOpts(axisOrSignal, signal)
  )
}

/**
 * Feature records for gene symbols / ids / accessions, narrowed to this matrix.
 * Each token is one `GET /features/{id}` (or a `symbol` filter at the `/features`
 * root); the nested `/matrices/{id}/features` route takes no ID list. `filters`
 * (root filters) intersect the result.
 */
export async function lookupMatrixFeatures(
  matrixId: string,
  tokens: readonly string[],
  opts: { filters?: UiFilter[]; maxResults?: number; signal?: AbortSignal } = {}
): Promise<Feature[]> {
  const filters = opts.filters?.length ? opts.filters : undefined
  const key = JSON.stringify([
    'lookup-features',
    matrixId,
    tokens,
    (filters ?? []).map((f) => filterKey(f)),
    opts.maxResults ?? 0,
  ])
  const rows = await memoResolve(key, () =>
    resolveMatrixFeatures(matrixId, filters, tokens, opts.maxResults)
  )
  throwIfAborted(opts.signal)
  return rows
}

/** Biosample records for ids, narrowed to this matrix (`GET /biosamples/{id}` each). */
export async function lookupMatrixBiosamples(
  matrixId: string,
  tokens: readonly string[],
  opts: { filters?: UiFilter[]; maxResults?: number; signal?: AbortSignal } = {}
): Promise<Biosample[]> {
  const filters = opts.filters?.length ? opts.filters : undefined
  const key = JSON.stringify([
    'lookup-biosamples',
    matrixId,
    tokens,
    (filters ?? []).map((f) => filterKey(f)),
    opts.maxResults ?? 0,
  ])
  const rows = await memoResolve(key, () =>
    resolveMatrixBiosamples(matrixId, filters, tokens, opts.maxResults)
  )
  throwIfAborted(opts.signal)
  return rows
}

/** Every feature at the `/features` root matching `filters`, narrowed to this matrix. */
export async function matrixFeaturesMatching(
  matrixId: string,
  filters: UiFilter[],
  signal?: AbortSignal
): Promise<Feature[]> {
  const rows = await collectRootRecords<Feature>('/features', filters, matrixId)
  throwIfAborted(signal)
  return rows
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
  skip?: number
  limit?: number
  granularity?: Granularity
  signal?: AbortSignal
}

/**
 * Feature-scoped filters (for example `expression.percentile`) cannot be
 * evaluated per matrix any more: `/features/{id}/matrices` takes no filters.
 * They act as a gate on the feature itself, checked at the `/features` root.
 */
async function featurePassesFeatureFilters(
  featureId: string,
  filters: UiFilter[],
  signal?: AbortSignal
): Promise<boolean> {
  const feature = await getFeature(featureId, signal)
  const symbol = feature?.aliases?.[0] ?? feature?.featureIdentifier?.id
  if (!symbol) return false
  const page = await queryCollection<Feature>('/features', {
    filters: [...filters, symbolFilter(symbol)],
    granularity: 'record',
    skip: 0,
    limit: 5,
    signal})
  return page.results.some((row) => row.id === featureId)
}

/**
 * `/features/{id}/matrices` and `/biosamples/{id}/matrices` take no filters or
 * request parameters. Constraints are applied here: matrix-scoped filters
 * resolve at the `/matrices` root and feature-scoped ones gate the feature.
 */
async function listRelatedMatrixRows(
  path: string,
  opts: RelatedMatricesOpts,
  featureId?: string
): Promise<BeaconResult<Matrix>> {
  const granularity = opts.granularity ?? 'record'
  const skip = opts.skip ?? 0
  const limit = opts.limit ?? 50
  const matrixFilters = (opts.filters ?? []).filter((f) => scopeOf(f) === 'matrix')
  const featureFilters = (opts.filters ?? []).filter((f) => scopeOf(f) === 'feature')
  if (!matrixFilters.length && !featureFilters.length) {
    return queryCollection<Matrix>(path, {
      granularity,
      skip,
      limit,
      signal: opts.signal})
  }
  if (featureId && featureFilters.length) {
    const ok = await featurePassesFeatureFilters(featureId, featureFilters, opts.signal)
    if (!ok) return pagedResult<Matrix>([], skip, limit, granularity)
  }
  const related = await queryCollection<Matrix>(path, {
    granularity: 'record',
    skip: 0,
    limit: ROOT_PAGE,
    signal: opts.signal})
  let rows = related.results
  if (matrixFilters.length) {
    const matched = await collectRootRecords<Matrix & { matrixIds?: string[] }>(
      '/matrices',
      matrixFilters
    )
    const ids = new Set(matched.map((m) => m.id))
    rows = rows.filter((m) => ids.has(m.id))
  }
  return pagedResult(rows, skip, limit, granularity)
}

export function listFeatureMatrices(
  featureId: string,
  opts: RelatedMatricesOpts = {}
) {
  return listRelatedMatrixRows(
    `/features/${encodeURIComponent(featureId)}/matrices`,
    opts,
    featureId
  )
}

export function listBiosampleMatrices(
  biosampleId: string,
  opts: RelatedMatricesOpts = {}
) {
  return listRelatedMatrixRows(
    `/biosamples/${encodeURIComponent(biosampleId)}/matrices`,
    opts
  )
}

export async function listExpressionValues(
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
    granularity?: Granularity
    signal?: AbortSignal
  }
) {
  // expression_values takes no query.filters: restrict rows with the two ID lists
  // of requestParameters.expressionValue (resolve filters to ids with
  // lookupMatrixFeatures / lookupMatrixBiosamples first).
  const { featureIDList, biosampleIDList } = params
  const hasIdList = Boolean(featureIDList || biosampleIDList)
  const hasRange = params.minValue != null || params.maxValue != null
  const hasOrder = Boolean(params.order)
  const post =
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
      signal: params.signal,
      ...(post
        ? {
            requestParameters: {
              expressionValue: {
                featureIDList,
                biosampleIDList,
                minValue: params.minValue,
                maxValue: params.maxValue,
                order: params.order,
              },
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
      pageToken})
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
  const native = feature.featureIdentifier?.id
  if (native) seen.add(native)
}

function hasFeature(seen: Set<string>, token: string) {
  return seen.has(token)
}

function stubFeature(token: string): Feature {
  return {
    id: token,
    featureIdentifier: { id: token },
    aliases: [token],
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
      signal})
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
      signal})
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
    signal})
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
  const catalog = await matrixBiosampleCatalog(matrixId, signal)

  if (filters.length) {
    // Filters belong on collection roots; intersect with this matrix's biosamples.
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
      const inMatrix = catalog.get(sample.id)
      if (!inMatrix) continue
      seen.add(sample.id)
      items.push(inMatrix)
    }
  }

  const pendingIds = query.biosampleIds
    .filter((id) => !seen.has(id))
    .slice(0, MAX_COHORT - items.length)

  if (pendingIds.length) {
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
      signal})
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
