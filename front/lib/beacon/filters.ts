import { isBeaconScope, type BeaconScope } from '@/lib/scope-theme'
import type { BeaconFilter, FilteringTerm, Granularity, UiFilter } from './types'

/** Shared by features lens URL parsing (Beacon ontology + gene public ids). */
const ONTOLOGY_ID =
  /^(SO|GO|OBI|UBERON|EFO|MONDO|HP|NCIT|HGNC|ENSEMBL|NCBIGENE|NCBIGene):.+/i

const BIOSAMPLE_OBI_ORIGIN = new Set(['OBI:0001876', 'OBI:0001479'])

export function isOntologyId(value: string): boolean {
  return ONTOLOGY_ID.test(value.trim())
}

export function isCustomId(value: string): boolean {
  const text = value.trim()
  return text.toLowerCase().startsWith('resource:')
}

/** Biosample fields sent as Beacon alphanumeric filters (sex uses kind `sex`). */
export const BIOSAMPLE_ALPHANUMERIC_FIELD_IDS = new Set([
  'age_bracket',
  'condition',
  'timepoint',
  'rin',
  'ischemic_time_min',
])

const BIOSAMPLE_ALPHANUMERIC_URL_PARAMS = [
  'age_bracket',
  'condition',
  'timepoint',
  'rin',
  'ischemic_time_min',
] as const

/** Matrix fields sent as Beacon alphanumeric filters. */
export const MATRIX_ALPHANUMERIC_FIELD_IDS = new Set([
  'matrix.unit',
  'matrix.scale',
  'matrix.annotation.source',
  'matrix.annotation.version',
  'matrix.assembly.name',
  'matrix.reproducible',
  'matrix.profileSource',
])

export const MATRIX_ALPHANUMERIC_URL_PARAMS = [
  'matrix.unit',
  'matrix.scale',
  'matrix.annotation.source',
  'matrix.annotation.version',
  'matrix.assembly.name',
  'matrix.reproducible',
  'matrix.profileSource',
] as const

export type FilterScope = 'feature' | 'biosample' | 'matrix'

export type FilterScopeIndex = Map<string, FilterScope>

function normalizeFilterTermId(id: string): string {
  return id.trim().toUpperCase()
}

function beaconScopeToFilterScope(scope: BeaconScope): FilterScope {
  if (scope === 'genomicFeature') return 'feature'
  return scope
}

/** Map filtering-term ids to lens scope using catalog `scopes` (case-insensitive keys). */
export function buildFilterScopeIndex(terms: FilteringTerm[]): FilterScopeIndex {
  const map: FilterScopeIndex = new Map()
  for (const term of terms) {
    const id = term.id?.trim()
    if (!id) continue
    const scopes = (term.scopes ?? []).filter(isBeaconScope)
    if (scopes.length === 0) continue
    // Prefer matrix > biosample > feature when a id is registered under multiple scopes.
    const priority: Record<BeaconScope, number> = {
      matrix: 3,
      biosample: 2,
      genomicFeature: 1,
    }
    const best = scopes.reduce((a, b) =>
      priority[b] > priority[a] ? b : a
    )
    map.set(normalizeFilterTermId(id), beaconScopeToFilterScope(best))
  }
  return map
}

export function mergeFilterScopeIndexes(
  ...indexes: Array<FilterScopeIndex | undefined>
): FilterScopeIndex {
  const merged: FilterScopeIndex = new Map()
  for (const index of indexes) {
    if (!index) continue
    for (const [key, scope] of index) merged.set(key, scope)
  }
  return merged
}

export function scopeOf(filter: UiFilter, index?: FilterScopeIndex): FilterScope {
  if (filter.kind === 'symbol') return 'feature'
  if (filter.kind === 'matrixUnit') return 'feature'
  if (filter.kind === 'sex') return 'biosample'
  if (filter.kind === 'alphanumeric') {
    if (MATRIX_ALPHANUMERIC_FIELD_IDS.has(filter.id)) return 'matrix'
    if (filter.id === 'genomicFeature.symbol') return 'feature'
    if (BIOSAMPLE_ALPHANUMERIC_FIELD_IDS.has(filter.id)) return 'biosample'
    return 'feature'
  }
  if (filter.kind === 'custom') {
    if (filter.id.toLowerCase().startsWith('resource:')) return 'feature'
    return 'biosample'
  }
  if (filter.kind === 'ontology' && index) {
    const hit = index.get(normalizeFilterTermId(filter.id))
    if (hit) return hit
  }
  const prefix = filter.id.split(':', 1)[0]?.toUpperCase() ?? ''
  const idUpper = filter.id.toUpperCase()
  if (prefix === 'UBERON' || prefix === 'EFO' || prefix === 'MONDO' || prefix === 'HP') {
    return 'biosample'
  }
  if (prefix === 'NCIT') return 'biosample'
  if (prefix === 'OBI') {
    if (BIOSAMPLE_OBI_ORIGIN.has(filter.id) || BIOSAMPLE_OBI_ORIGIN.has(idUpper)) {
      return 'biosample'
    }
    return 'matrix'
  }
  if (prefix === 'GO') return 'feature'
  return 'feature'
}

/**
 * Filters applicable to GET/POST /features.
 * SO terms stay here even when the catalog also scopes them to matrices.
 */
export function isFeatureLensFilter(filter: UiFilter, index?: FilterScopeIndex): boolean {
  if (filter.kind === 'symbol') return true
  if (filter.kind === 'sex' || filter.kind === 'matrixUnit') return false
  if (filter.kind === 'alphanumeric') return filter.id === 'genomicFeature.symbol'
  if (filter.kind === 'custom') {
    if (filter.id.toLowerCase().startsWith('resource:')) return true
    if (index) {
      const hit = index.get(normalizeFilterTermId(filter.id))
      if (hit !== undefined) return hit === 'feature'
    }
    return false
  }
  const prefix = filter.id.split(':', 1)[0]?.toUpperCase() ?? ''
  if (prefix === 'SO') return true
  if (index) {
    const hit = index.get(normalizeFilterTermId(filter.id))
    if (hit !== undefined) return hit === 'feature'
  }
  return scopeOf(filter, index) === 'feature'
}

/** Filters applicable to GET/POST /matrices (SO feature types + matrix alphanumerics + OBI). */
export function isMatrixLensFilter(filter: UiFilter, index?: FilterScopeIndex): boolean {
  if (filter.kind === 'alphanumeric' && MATRIX_ALPHANUMERIC_FIELD_IDS.has(filter.id)) {
    return true
  }
  if (filter.kind === 'ontology') {
    const prefix = filter.id.split(':', 1)[0]?.toUpperCase() ?? ''
    const idUpper = filter.id.toUpperCase()
    // Matrices accept SO feature types even when the catalog scopes SO to genomicFeature.
    if (prefix === 'SO') return true
    if (index) {
      const hit = index.get(normalizeFilterTermId(filter.id))
      if (hit !== undefined) return hit === 'matrix'
    }
    if (prefix === 'OBI') {
      return !(
        BIOSAMPLE_OBI_ORIGIN.has(filter.id) || BIOSAMPLE_OBI_ORIGIN.has(idUpper)
      )
    }
    return false
  }
  return false
}

export function filterKey(filter: UiFilter): string {
  if (filter.kind === 'symbol') return `symbol:${filter.value}`
  if (filter.kind === 'sex') return `sex:${filter.value}`
  if (filter.kind === 'matrixUnit') return `matrixUnit:${filter.value}`
  if (filter.kind === 'alphanumeric') return `alphanumeric:${filter.id}:${filter.value}`
  return `${filter.kind}:${filter.id}`
}

export function filterLabel(filter: UiFilter): string {
  if (filter.kind === 'symbol') return filter.value
  if (filter.kind === 'sex') return `sex = ${filter.value}`
  if (filter.kind === 'matrixUnit') return `unit = ${filter.value}`
  if (filter.kind === 'alphanumeric') {
    return filter.label?.trim() || `${filter.id} = ${filter.value}`
  }
  return filter.label || filter.id
}

export function toBeaconFilter(filter: UiFilter): BeaconFilter {
  if (filter.kind === 'symbol') {
    return { id: 'genomicFeature.symbol', operator: '=', value: filter.value }
  }
  if (filter.kind === 'sex') {
    return { id: 'sex', operator: '=', value: filter.value }
  }
  if (filter.kind === 'matrixUnit') {
    return { id: 'matrix.unit', operator: '=', value: filter.value }
  }
  if (filter.kind === 'alphanumeric') {
    return { id: filter.id, operator: '=', value: filter.value }
  }
  return { id: filter.id }
}

export function needsPost(filters: UiFilter[] | undefined): boolean {
  return Boolean(
    filters?.some(
      (filter) =>
        filter.kind === 'symbol' ||
        filter.kind === 'sex' ||
        filter.kind === 'matrixUnit' ||
        filter.kind === 'alphanumeric'
    )
  )
}

export function dedupeFilters(filters: UiFilter[]): UiFilter[] {
  const seen = new Set<string>()
  const out: UiFilter[] = []
  for (const filter of filters) {
    const key = filterKey(filter)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(filter)
  }
  return out
}

function pushId(filters: UiFilter[], id: string) {
  const text = id.trim()
  if (!text) return
  if (isCustomId(text)) {
    filters.push({ kind: 'custom', id: text })
    return
  }
  filters.push({ kind: 'ontology', id: text })
}

export function parseCatalogSearch(params: URLSearchParams): {
  filters: UiFilter[]
  granularity: Granularity | null
  skip: number
  limit: number
} {
  const filters: UiFilter[] = []
  const csv = params.get('filters')
  if (csv) {
    for (const token of csv.split(',')) pushId(filters, token)
  }
  const symbol = params.get('symbol')
  if (symbol) {
    for (const token of symbol.split(',')) {
      const value = token.trim()
      if (value) filters.push({ kind: 'symbol', value })
    }
  }
  const sex = params.get('sex')?.trim()
  if (sex) filters.push({ kind: 'sex', value: sex })
  for (const field of BIOSAMPLE_ALPHANUMERIC_URL_PARAMS) {
    const value = params.get(field)?.trim()
    if (value) filters.push({ kind: 'alphanumeric', id: field, value })
  }
  for (const field of MATRIX_ALPHANUMERIC_URL_PARAMS) {
    const value = params.get(field)?.trim()
    if (value) filters.push({ kind: 'alphanumeric', id: field, value })
  }
  const rawGranularity = params.get('granularity')
  const granularity =
    rawGranularity === 'boolean' ||
    rawGranularity === 'count' ||
    rawGranularity === 'record'
      ? rawGranularity
      : null
  const skip = Math.max(0, Number(params.get('skip') ?? 0) || 0)
  const limitRaw = Number(params.get('limit') ?? 0)
  const limit = limitRaw > 0 ? limitRaw : 20
  return { filters: dedupeFilters(filters), granularity, skip, limit }
}

export type GeneLensSearch = {
  featureFilters: UiFilter[]
  feature: string | null
  matrix: string | null
  unit: string | null
}

export function parseGeneLensSearch(
  params: URLSearchParams,
  index?: FilterScopeIndex
): GeneLensSearch {
  const { filters } = parseCatalogSearch(params)
  const featureFilters = filters.filter((f) => isFeatureLensFilter(f, index))
  return {
    featureFilters: dedupeFilters(featureFilters),
    feature: params.get('feature'),
    matrix: params.get('matrix'),
    unit: params.get('unit'),
  }
}

export function geneLensSearchParams(opts: {
  filters: UiFilter[]
  feature?: string | null
  matrix?: string | null
  unit?: string | null
  index?: FilterScopeIndex
}): URLSearchParams {
  const featureOnly = dedupeFilters(
    opts.filters.filter((f) => isFeatureLensFilter(f, opts.index))
  )
  const base = catalogSearchParams({
    filters: featureOnly,
    granularity: 'record',
  })
  base.delete('granularity')
  base.delete('skip')
  base.delete('limit')
  base.delete('sex')
  if (opts.feature) base.set('feature', opts.feature)
  else base.delete('feature')
  if (opts.matrix) base.set('matrix', opts.matrix)
  else base.delete('matrix')
  if (opts.unit) base.set('unit', opts.unit)
  else base.delete('unit')
  return base
}

export type SampleLensSearch = {
  biosampleFilters: UiFilter[]
  sample: string | null
  matrix: string | null
  unit: string | null
}

export function parseSampleLensSearch(
  params: URLSearchParams,
  index?: FilterScopeIndex
): SampleLensSearch {
  const { filters } = parseCatalogSearch(params)
  const biosampleFilters = filters.filter((f) => scopeOf(f, index) === 'biosample')
  return {
    biosampleFilters: dedupeFilters(biosampleFilters),
    sample: params.get('sample'),
    matrix: params.get('matrix'),
    unit: params.get('unit'),
  }
}

export function sampleLensSearchParams(opts: {
  filters: UiFilter[]
  sample?: string | null
  matrix?: string | null
  unit?: string | null
  index?: FilterScopeIndex
}): URLSearchParams {
  const biosampleOnly = dedupeFilters(
    opts.filters.filter((f) => scopeOf(f, opts.index) === 'biosample')
  )
  const base = catalogSearchParams({
    filters: biosampleOnly,
    granularity: 'record',
  })
  base.delete('granularity')
  base.delete('skip')
  base.delete('limit')
  base.delete('symbol')
  for (const field of BIOSAMPLE_ALPHANUMERIC_URL_PARAMS) {
    base.delete(field)
  }
  for (const filter of biosampleOnly) {
    if (filter.kind === 'alphanumeric') base.set(filter.id, filter.value)
  }
  if (opts.sample) base.set('sample', opts.sample)
  else base.delete('sample')
  if (opts.matrix) base.set('matrix', opts.matrix)
  else base.delete('matrix')
  if (opts.unit) base.set('unit', opts.unit)
  else base.delete('unit')
  return base
}

export type MatrixLensSearch = {
  matrixFilters: UiFilter[]
  matrix: string | null
}

export function parseMatrixLensSearch(
  params: URLSearchParams,
  index?: FilterScopeIndex
): MatrixLensSearch {
  const { filters } = parseCatalogSearch(params)
  const matrixFilters = filters.filter((f) => isMatrixLensFilter(f, index))
  return {
    matrixFilters: dedupeFilters(matrixFilters),
    matrix: params.get('matrix'),
  }
}

export function matrixLensSearchParams(opts: {
  filters: UiFilter[]
  matrix?: string | null
  index?: FilterScopeIndex
}): URLSearchParams {
  const matrixOnly = dedupeFilters(
    opts.filters.filter((f) => isMatrixLensFilter(f, opts.index))
  )
  const base = catalogSearchParams({
    filters: matrixOnly,
    granularity: 'record',
  })
  base.delete('granularity')
  base.delete('skip')
  base.delete('limit')
  base.delete('symbol')
  base.delete('sex')
  for (const field of BIOSAMPLE_ALPHANUMERIC_URL_PARAMS) {
    base.delete(field)
  }
  for (const field of MATRIX_ALPHANUMERIC_URL_PARAMS) {
    base.delete(field)
  }
  for (const filter of matrixOnly) {
    if (filter.kind === 'alphanumeric') base.set(filter.id, filter.value)
  }
  if (opts.matrix) base.set('matrix', opts.matrix)
  else base.delete('matrix')
  return base
}

export function filtersQuerySummary(filters: UiFilter[]): string {
  if (!filters.length) return 'your filters'
  return filters.map((f) => filterLabel(f)).join(' · ')
}

export function compareGeneToken(filters: UiFilter[]): string {
  const symbol = filters.find((f) => f.kind === 'symbol')
  if (symbol && symbol.kind === 'symbol') return symbol.value
  const first = filters[0]
  return first ? filterLabel(first) : 'gene'
}

export function catalogSearchParams(opts: {
  filters: UiFilter[]
  granularity: Granularity
  skip?: number
  limit?: number
}): URLSearchParams {
  const params = new URLSearchParams()
  const ids = opts.filters
    .filter((filter) => filter.kind === 'ontology' || filter.kind === 'custom')
    .map((filter) => (filter.kind === 'ontology' ? filter.id : filter.id))
  if (ids.length) params.set('filters', ids.join(','))
  const symbols = opts.filters
    .filter((filter): filter is { kind: 'symbol'; value: string } => filter.kind === 'symbol')
    .map((filter) => filter.value)
  if (symbols.length) params.set('symbol', symbols.join(','))
  const sex = opts.filters.find((filter) => filter.kind === 'sex')
  if (sex && sex.kind === 'sex') params.set('sex', sex.value)
  for (const filter of opts.filters) {
    if (filter.kind === 'alphanumeric') params.set(filter.id, filter.value)
  }
  params.set('granularity', opts.granularity)
  if (opts.skip) params.set('skip', String(opts.skip))
  if (opts.limit && opts.limit !== 20) params.set('limit', String(opts.limit))
  return params
}

export type MatrixQuery = {
  filters: UiFilter[]
  featureIds: string[]
  biosampleIds: string[]
  genes: string[]
  minValue?: number
  maxValue?: number
}

function optionalNumber(raw: string | null): number | undefined {
  if (raw == null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function csv(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

export function parseMatrixQuery(params: URLSearchParams): MatrixQuery {
  const { filters } = parseCatalogSearch(params)
  return {
    filters,
    featureIds: csv(params.get('featureIds')).slice(0, 100),
    biosampleIds: csv(params.get('biosampleIds')).slice(0, 100),
    genes: csv(params.get('genes')).slice(0, 100),
    minValue: optionalNumber(params.get('minValue')),
    maxValue: optionalNumber(params.get('maxValue')),
  }
}

export function matrixSearchParams(
  current: URLSearchParams,
  patch: Partial<MatrixQuery> & { filters?: UiFilter[] }
): URLSearchParams {
  const params = new URLSearchParams(current.toString())
  params.delete('skip')
  params.delete('limit')
  params.delete('granularity')
  if (patch.filters) {
    params.delete('filters')
    params.delete('symbol')
    params.delete('sex')
    for (const field of BIOSAMPLE_ALPHANUMERIC_URL_PARAMS) params.delete(field)
    for (const field of MATRIX_ALPHANUMERIC_URL_PARAMS) params.delete(field)
    const next = catalogSearchParams({
      filters: patch.filters,
      granularity: 'record',
    })
    const filters = next.get('filters')
    const symbol = next.get('symbol')
    const sex = next.get('sex')
    if (filters) params.set('filters', filters)
    if (symbol) params.set('symbol', symbol)
    if (sex) params.set('sex', sex)
    for (const field of BIOSAMPLE_ALPHANUMERIC_URL_PARAMS) {
      const value = next.get(field)
      if (value) params.set(field, value)
    }
    for (const field of MATRIX_ALPHANUMERIC_URL_PARAMS) {
      const value = next.get(field)
      if (value) params.set(field, value)
    }
  }
  if (patch.featureIds) {
    if (patch.featureIds.length) params.set('featureIds', patch.featureIds.join(','))
    else params.delete('featureIds')
  }
  if (patch.biosampleIds) {
    if (patch.biosampleIds.length) params.set('biosampleIds', patch.biosampleIds.join(','))
    else params.delete('biosampleIds')
  }
  if (patch.genes) {
    if (patch.genes.length) params.set('genes', patch.genes.join(','))
    else params.delete('genes')
  }
  if ('minValue' in patch) {
    if (patch.minValue == null) params.delete('minValue')
    else params.set('minValue', String(patch.minValue))
  }
  if ('maxValue' in patch) {
    if (patch.maxValue == null) params.delete('maxValue')
    else params.set('maxValue', String(patch.maxValue))
  }
  return params
}

const SHARED_QUERY_KEYS = [
  'filters',
  'symbol',
  'sex',
  ...BIOSAMPLE_ALPHANUMERIC_URL_PARAMS,
  ...MATRIX_ALPHANUMERIC_URL_PARAMS,
] as const

export function preserveQuery(href: string, current: URLSearchParams): string {
  const [path, query = ''] = href.split('?')
  const params = new URLSearchParams(query)
  for (const key of SHARED_QUERY_KEYS) {
    const value = current.get(key)
    if (value && !params.has(key)) params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export function withoutFilter(
  current: URLSearchParams,
  remove: UiFilter
): URLSearchParams {
  const parsed = parseCatalogSearch(current)
  const filters = parsed.filters.filter((filter) => filterKey(filter) !== filterKey(remove))
  const next = new URLSearchParams(current.toString())
  next.delete('filters')
  next.delete('symbol')
  next.delete('sex')
  for (const field of BIOSAMPLE_ALPHANUMERIC_URL_PARAMS) next.delete(field)
  for (const field of MATRIX_ALPHANUMERIC_URL_PARAMS) next.delete(field)
  next.delete('skip')
  const shared = catalogSearchParams({
    filters,
    granularity: parsed.granularity ?? 'record',
  })
  for (const key of SHARED_QUERY_KEYS) {
    const value = shared.get(key)
    if (value) next.set(key, value)
  }
  return next
}

export function matrixHref(id: string, extra?: string): string {
  const params = new URLSearchParams(extra ?? '')
  const enc = encodeURIComponent(id)
  const qs = params.toString()
  return qs ? `/matrices/${enc}/?${qs}` : `/matrices/${enc}/`
}

export function tokenToFilter(
  token: string,
  scope: 'feature' | 'biosample' | 'matrix' | 'both',
  index?: FilterScopeIndex
): UiFilter | null {
  const text = token.trim()
  if (!text) return null
  if (isCustomId(text)) {
    const filter: UiFilter = { kind: 'custom', id: text }
    if (scope !== 'both' && scopeOf(filter, index) !== scope) return null
    return filter
  }
  if (isOntologyId(text)) {
    const filter: UiFilter = { kind: 'ontology', id: text }
    if (scope === 'matrix') {
      if (!isMatrixLensFilter(filter, index)) return null
      return filter
    }
    if (scope !== 'both' && scopeOf(filter, index) !== scope) return null
    return filter
  }
  if (scope === 'biosample' || scope === 'matrix') return null
  return { kind: 'symbol', value: text }
}
