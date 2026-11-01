import type { BeaconFilter, Granularity, UiFilter } from './types'

const ONTOLOGY_ID =
  /^(SO|UBERON|EFO|HGNC|ENSEMBL|NCBIGENE|NCBIGene):.+/i

export function isOntologyId(value: string): boolean {
  return ONTOLOGY_ID.test(value.trim())
}

export function isCustomId(value: string): boolean {
  const text = value.trim()
  return text === 'GEO:sample' || text.toLowerCase().startsWith('resource:')
}

export function scopeOf(filter: UiFilter): 'feature' | 'biosample' {
  if (filter.kind === 'symbol') return 'feature'
  if (filter.kind === 'sex') return 'biosample'
  if (filter.kind === 'custom') {
    if (filter.id.toLowerCase().startsWith('resource:')) return 'feature'
    return 'biosample'
  }
  const prefix = filter.id.split(':', 1)[0]?.toUpperCase() ?? ''
  if (prefix === 'UBERON' || prefix === 'EFO') return 'biosample'
  return 'feature'
}

export function filterKey(filter: UiFilter): string {
  if (filter.kind === 'symbol') return `symbol:${filter.value}`
  if (filter.kind === 'sex') return `sex:${filter.value}`
  return `${filter.kind}:${filter.id}`
}

export function filterLabel(filter: UiFilter): string {
  if (filter.kind === 'symbol') return filter.value
  if (filter.kind === 'sex') return `sex = ${filter.value}`
  return filter.label || filter.id
}

export function toBeaconFilter(filter: UiFilter): BeaconFilter {
  if (filter.kind === 'symbol') {
    return { id: 'genomicFeature.symbol', operator: '=', value: filter.value }
  }
  if (filter.kind === 'sex') {
    return { id: 'sex', operator: '=', value: filter.value }
  }
  return { id: filter.id }
}

export function needsPost(filters: UiFilter[] | undefined): boolean {
  return Boolean(filters?.some((filter) => filter.kind === 'symbol' || filter.kind === 'sex'))
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
    filters.push({ kind: 'custom', id: text === 'GEO:sample' ? 'GEO:sample' : text })
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

const SHARED_QUERY_KEYS = ['filters', 'symbol', 'sex'] as const

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
  params.set('id', id)
  return `/matrices/view/?${params}`
}

export function tokenToFilter(
  token: string,
  scope: 'feature' | 'biosample' | 'both'
): UiFilter | null {
  const text = token.trim()
  if (!text) return null
  if (isCustomId(text)) {
    const filter: UiFilter = {
      kind: 'custom',
      id: text.toLowerCase().startsWith('resource:') ? text : 'GEO:sample',
    }
    if (scope !== 'both' && scopeOf(filter) !== scope) return null
    return filter
  }
  if (isOntologyId(text)) {
    const filter: UiFilter = { kind: 'ontology', id: text }
    if (scope !== 'both' && scopeOf(filter) !== scope) return null
    return filter
  }
  if (scope === 'biosample') return null
  return { kind: 'symbol', value: text }
}
