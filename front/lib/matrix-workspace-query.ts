import type { FilterScopeIndex } from '@/lib/beacon/filters'
import {
  catalogSearchParams,
  dedupeFilters,
  filterKey,
  isCustomId,
  isFeatureLensFilter,
  isOntologyId,
  isSymbolCustomId,
  parseCatalogSearch,
  scopeOf,
  symbolCustomFilter,
  symbolFromCustomId,
  tokenToFilter,
} from '@/lib/beacon/filters'
import type { FilteringTerm, UiFilter } from '@/lib/beacon/types'
import { RECORD_ID_PARAM, RECORD_KIND_PARAM } from '@/lib/entity-record-sheet'

export type MatrixFeatureSort = 'id' | 'expression.max' | 'expression.min'
export type MatrixFeatureOrder = 'asc' | 'desc'

export type MatrixWorkspaceQuery = {
  featureFilters: UiFilter[]
  genes: string[]
  featureIds: string[]
  biosampleFilters: UiFilter[]
  biosampleIds: string[]
  /** Cell-scoped expression.* alphanumeric filters (e.g. expression.value). */
  expressionFilters: UiFilter[]
  minValue?: number
  maxValue?: number
  sort: MatrixFeatureSort
  order: MatrixFeatureOrder
}

const TOKEN_CAP = 100

function csv(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

function optionalNumber(raw: string | null): number | undefined {
  if (raw == null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function pushUnique(out: string[], seen: Set<string>, raw: string, cap: number) {
  const value = raw.trim()
  if (!value || out.length >= cap) return
  const key = value.toUpperCase()
  if (seen.has(key)) return
  seen.add(key)
  out.push(value)
}

export function emptyMatrixWorkspaceQuery(): MatrixWorkspaceQuery {
  return {
    featureFilters: [],
    genes: [],
    featureIds: [],
    biosampleFilters: [],
    biosampleIds: [],
    expressionFilters: [],
    sort: 'expression.max',
    order: 'desc',
  }
}

/** Parse the matrix workspace URL. Record-sheet params are ignored. */
export function parseMatrixWorkspaceQuery(
  params: URLSearchParams,
  index?: FilterScopeIndex
): MatrixWorkspaceQuery {
  const { filters } = parseCatalogSearch(params)
  const featureFilters: UiFilter[] = []
  const biosampleFilters: UiFilter[] = []
  const expressionFilters: UiFilter[] = []
  const genes: string[] = []
  const seenGenes = new Set<string>()

  for (const filter of filters) {
    if (filter.kind === 'symbol') {
      pushUnique(genes, seenGenes, filter.value, TOKEN_CAP)
      continue
    }
    if (filter.kind === 'custom' && isSymbolCustomId(filter.id)) {
      pushUnique(genes, seenGenes, symbolFromCustomId(filter.id), TOKEN_CAP)
      continue
    }
    if (scopeOf(filter, index) === 'expressionValue') {
      expressionFilters.push(filter)
      continue
    }
    if (scopeOf(filter, index) === 'biosample') {
      biosampleFilters.push(filter)
      continue
    }
    if (isFeatureLensFilter(filter, index)) featureFilters.push(filter)
  }

  for (const gene of csv(params.get('genes'))) {
    pushUnique(genes, seenGenes, gene, TOKEN_CAP)
  }

  const featureIds: string[] = []
  const seenIds = new Set<string>()
  for (const id of csv(params.get('featureIds'))) {
    pushUnique(featureIds, seenIds, id, TOKEN_CAP)
  }

  const biosampleIds: string[] = []
  const seenBios = new Set<string>()
  for (const id of csv(params.get('biosampleIds'))) {
    pushUnique(biosampleIds, seenBios, id, TOKEN_CAP)
  }

  const sortRaw = params.get('sort')
  // Feature-id sort is no longer offered in the UI; treat missing/legacy `id` as highest max.
  const sort: MatrixFeatureSort =
    sortRaw === 'expression.min' ? 'expression.min' : 'expression.max'
  const orderRaw = params.get('order')
  const defaultOrder: MatrixFeatureOrder = sort === 'expression.min' ? 'asc' : 'desc'
  const order: MatrixFeatureOrder =
    orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : defaultOrder

  return {
    featureFilters: dedupeFilters(featureFilters),
    genes,
    featureIds,
    biosampleFilters: dedupeFilters(biosampleFilters),
    biosampleIds,
    expressionFilters: dedupeFilters(expressionFilters),
    minValue: optionalNumber(params.get('minValue')),
    maxValue: optionalNumber(params.get('maxValue')),
    sort,
    order,
  }
}

/** Stable identity for data fetching. Record-sheet params are not part of it. */
export function matrixWorkspaceQueryKey(query: MatrixWorkspaceQuery): string {
  return JSON.stringify({
    featureFilters: query.featureFilters.map(filterKey),
    genes: query.genes.map((gene) => gene.toUpperCase()),
    featureIds: query.featureIds,
    biosampleFilters: query.biosampleFilters.map(filterKey),
    biosampleIds: query.biosampleIds,
    expressionFilters: query.expressionFilters.map(filterKey),
    minValue: query.minValue ?? null,
    maxValue: query.maxValue ?? null,
    sort: query.sort,
    order: query.order,
  })
}

export function matrixWorkspaceHasConstraints(query: MatrixWorkspaceQuery): boolean {
  return (
    query.featureFilters.length > 0 ||
    query.genes.length > 0 ||
    query.featureIds.length > 0 ||
    query.biosampleFilters.length > 0 ||
    query.biosampleIds.length > 0 ||
    query.expressionFilters.length > 0 ||
    query.minValue != null ||
    query.maxValue != null
  )
}

export function matrixWorkspaceSearchParams(
  query: MatrixWorkspaceQuery,
  preserve?: URLSearchParams
): URLSearchParams {
  const params = catalogSearchParams({
    filters: [
      ...query.featureFilters,
      ...query.biosampleFilters,
      ...query.expressionFilters,
      ...query.genes.map((value) => symbolCustomFilter(value)),
    ],
    granularity: 'record',
  })
  params.delete('granularity')
  params.delete('skip')
  params.delete('limit')
  if (query.featureIds.length) params.set('featureIds', query.featureIds.join(','))
  if (query.biosampleIds.length) params.set('biosampleIds', query.biosampleIds.join(','))
  if (query.minValue != null) params.set('minValue', String(query.minValue))
  if (query.maxValue != null) params.set('maxValue', String(query.maxValue))
  if (query.sort !== 'expression.max') params.set('sort', query.sort)
  const defaultOrder: MatrixFeatureOrder = query.sort === 'expression.min' ? 'asc' : 'desc'
  if (query.order !== defaultOrder) params.set('order', query.order)
  if (preserve) {
    for (const key of [RECORD_KIND_PARAM, RECORD_ID_PARAM]) {
      const value = preserve.get(key)
      if (value) params.set(key, value)
    }
  }
  return params
}

/** Symbols and explicit ids, capped, for `featureIDList`. */
export function featureIdListCsv(query: Pick<MatrixWorkspaceQuery, 'genes' | 'featureIds'>): string | undefined {
  const out: string[] = []
  const seen = new Set<string>()
  for (const token of [...query.genes, ...query.featureIds]) {
    pushUnique(out, seen, token, TOKEN_CAP)
  }
  return out.length ? out.join(',') : undefined
}

export function biosampleIdListCsv(
  query: Pick<MatrixWorkspaceQuery, 'biosampleIds'>
): string | undefined {
  return query.biosampleIds.length ? query.biosampleIds.join(',') : undefined
}

const FEATURE_ACCESSION = /^(ENSG|ENST|ENSMUSG|ENSMUST|NM_|NP_|feature-)/i
const BIOSAMPLE_ACCESSION = /^(GTEX-|ENCBS|SAMN|SRS|GSM)/i

export type QueryToken =
  | { ok: true; kind: 'filter'; filter: UiFilter }
  | { ok: true; kind: 'gene'; value: string }
  | { ok: true; kind: 'featureId'; value: string }
  | { ok: true; kind: 'biosampleId'; value: string }
  | { ok: false; message: string }

function withLabel(filter: UiFilter, terms: FilteringTerm[]): UiFilter {
  if (filter.kind !== 'ontology' && filter.kind !== 'custom') return filter
  const match = terms.find((term) => term.id.toLowerCase() === filter.id.toLowerCase())
  return { ...filter, label: match?.label ?? filter.label }
}

function exactTerm(terms: FilteringTerm[], raw: string, scope: 'feature' | 'biosample'): FilteringTerm | undefined {
  const q = raw.trim().toLowerCase()
  return terms.find((term) => {
    const scoped = term.scopes?.includes(scope === 'feature' ? 'genomicFeature' : 'biosample') ?? false
    if (!scoped && term.scopes?.length) return false
    return term.id.toLowerCase() === q || (term.label ?? '').trim().toLowerCase() === q
  })
}

export function interpretFeatureQueryToken(
  raw: string,
  terms: FilteringTerm[],
  index?: FilterScopeIndex
): QueryToken {
  const text = raw.trim()
  if (!text) return { ok: false, message: 'Enter a gene, id, or filter.' }

  const labeled = exactTerm(terms, text, 'feature')
  if (labeled && (labeled.type === 'SO' || labeled.type === 'GO' || isOntologyId(labeled.id))) {
    return {
      ok: true,
      kind: 'filter',
      filter: { kind: 'ontology', id: labeled.id, label: labeled.label },
    }
  }

  if (FEATURE_ACCESSION.test(text)) return { ok: true, kind: 'featureId', value: text }

  const typed = tokenToFilter(text, 'feature', index)
  if (typed) {
    if ((typed.kind === 'ontology' || typed.kind === 'custom') && typed.id.toLowerCase().startsWith('resource:ncbigene')) {
      return { ok: false, message: `${typed.id} is not a filter for this matrix.` }
    }
    if (typed.kind === 'symbol') return { ok: true, kind: 'gene', value: typed.value }
    if (typed.kind === 'custom' && isSymbolCustomId(typed.id)) {
      return { ok: true, kind: 'gene', value: symbolFromCustomId(typed.id) }
    }
    return { ok: true, kind: 'filter', filter: withLabel(typed, terms) }
  }

  if (isOntologyId(text) || isCustomId(text)) {
    const any = tokenToFilter(text, 'both', index)
    const scope = any ? scopeOf(any, index) : undefined
    if (scope === 'biosample') {
      return { ok: false, message: `${text} filters biosamples. Add it in the biosample field.` }
    }
    if (scope === 'matrix') {
      return { ok: false, message: `${text} selects matrices, not rows in this matrix.` }
    }
    return { ok: false, message: `${text} is not a feature filter in this matrix.` }
  }

  return { ok: true, kind: 'gene', value: text }
}

export function interpretBiosampleQueryToken(
  raw: string,
  terms: FilteringTerm[],
  index?: FilterScopeIndex
): QueryToken {
  const text = raw.trim()
  if (!text) return { ok: false, message: 'Enter a biosample id or filter.' }

  if (BIOSAMPLE_ACCESSION.test(text) || text.includes('-SM-')) {
    return { ok: true, kind: 'biosampleId', value: text }
  }

  const sexTerm = terms.find((term) => term.id === 'sex')
  const sex = sexTerm?.values?.find((value) => value.toLowerCase() === text.toLowerCase())
  if (sex) return { ok: true, kind: 'filter', filter: { kind: 'sex', value: sex } }

  for (const term of terms) {
    if (term.type !== 'alphanumeric') continue
    if (term.scopes?.length && !term.scopes.includes('biosample')) continue
    const hit = term.values?.find((value) => value.toLowerCase() === text.toLowerCase())
    if (!hit) continue
    return {
      ok: true,
      kind: 'filter',
      filter: {
        kind: 'alphanumeric',
        id: term.id,
        value: hit,
        label: `${term.label ?? term.id} = ${hit}`,
      },
    }
  }

  const labeled = exactTerm(terms, text, 'biosample')
  if (labeled && isOntologyId(labeled.id)) {
    return {
      ok: true,
      kind: 'filter',
      filter: { kind: 'ontology', id: labeled.id, label: labeled.label },
    }
  }

  const typed = tokenToFilter(text, 'biosample', index)
  if (typed && typed.kind === 'ontology') {
    return { ok: true, kind: 'filter', filter: withLabel(typed, terms) }
  }

  if (isOntologyId(text) || isCustomId(text)) {
    const any = tokenToFilter(text, 'both', index)
    const scope = any ? scopeOf(any, index) : undefined
    if (scope === 'feature') {
      return { ok: false, message: `${text} filters features. Add it in the feature field.` }
    }
    return { ok: false, message: `${text} is not a biosample filter in this matrix.` }
  }

  if (/[0-9]/.test(text) || text.includes('-') || text.includes(':')) {
    return { ok: true, kind: 'biosampleId', value: text }
  }

  return {
    ok: false,
    message: `No biosample filter matches “${text}”. Choose a suggestion, or enter a biosample id.`,
  }
}

export type QuerySuggestion = { label: string; token: string }

export function querySuggestions(
  terms: FilteringTerm[],
  raw: string,
  scope: 'feature' | 'biosample',
  limit = 6
): QuerySuggestion[] {
  const q = raw.trim().toLowerCase()
  if (q.length < 2) return []
  const scopeName = scope === 'feature' ? 'genomicFeature' : 'biosample'
  const out: QuerySuggestion[] = []
  const seen = new Set<string>()
  const push = (label: string, token: string) => {
    const key = `${label}\u0000${token}`.toLowerCase()
    if (seen.has(key) || out.length >= limit) return
    seen.add(key)
    out.push({ label, token })
  }
  for (const term of terms) {
    if (term.scopes?.length && !term.scopes.includes(scopeName)) continue
    if (term.id.toLowerCase().startsWith('resource:')) continue
    const label = (term.label ?? '').trim()
    const ontology =
      isOntologyId(term.id) ||
      term.type === 'SO' ||
      term.type === 'GO' ||
      term.type === 'UBERON' ||
      term.type === 'EFO' ||
      term.type === 'MONDO' ||
      term.type === 'HP' ||
      term.type === 'NCIT'
    if (ontology && (label.toLowerCase().includes(q) || term.id.toLowerCase().includes(q))) {
      push(label || term.id, term.id)
    }
    if (term.type === 'alphanumeric') {
      for (const value of term.values ?? []) {
        if (!value.toLowerCase().includes(q)) continue
        const text = term.id === 'sex' ? value : `${label || term.id}: ${value}`
        push(text, value)
      }
    }
  }
  return out
}
