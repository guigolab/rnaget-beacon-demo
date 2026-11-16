import type { RecordedCall } from './recorder'

export type CallChipKind =
  | 'ontology'
  | 'alphanumeric'
  | 'pagination'
  | 'granularity'
  | 'requestParameter'
  | 'other'

export type CallChip = {
  kind: CallChipKind
  /** Short label before the value (parameter name, filter id). */
  label: string
  /** Value text; omitted for bare ontology ids. */
  value?: string
  /** Full text for the tooltip (long ID lists are shortened in the chip). */
  title: string
}

export type CallSummary = {
  method: 'GET' | 'POST'
  /** Path without the query string. */
  route: string
  chips: CallChip[]
}

const LIST_PREVIEW = 2

function listChip(label: string, raw: string): CallChip {
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean)
  const shown = ids.slice(0, LIST_PREVIEW).join(', ')
  const rest = ids.length - LIST_PREVIEW
  return {
    kind: 'requestParameter',
    label,
    value: rest > 0 ? `${shown} +${rest}` : shown,
    title: ids.join(', '),
  }
}

function filterChip(filter: {
  id?: string
  operator?: string
  value?: string
}): CallChip {
  const id = String(filter.id ?? '')
  if (filter.operator != null && filter.value != null) {
    return {
      kind: 'alphanumeric',
      label: id,
      value: `${filter.operator} ${filter.value}`,
      title: `${id} ${filter.operator} ${filter.value}`,
    }
  }
  return { kind: 'ontology', label: id, title: id }
}

function paramChip(key: string, value: unknown): CallChip | null {
  if (value == null || value === '') return null
  if (key === 'skip' || key === 'limit' || key === 'nextPage') {
    return {
      kind: 'pagination',
      label: key,
      value: key === 'nextPage' ? 'token' : String(value),
      title: `${key} = ${String(value)}`,
    }
  }
  if (key === 'requestedGranularity') {
    return {
      kind: 'granularity',
      label: 'granularity',
      value: String(value),
      title: `requestedGranularity = ${String(value)}`,
    }
  }
  if (key === 'featureIDList' || key === 'biosampleIDList') {
    return listChip(key, String(value))
  }
  return {
    kind: 'requestParameter',
    label: key,
    value: String(value),
    title: `${key} = ${String(value)}`,
  }
}

function splitPath(path: string): { route: string; query: URLSearchParams } {
  const index = path.indexOf('?')
  if (index < 0) return { route: path, query: new URLSearchParams() }
  return { route: path.slice(0, index), query: new URLSearchParams(path.slice(index + 1)) }
}

/**
 * Break a recorded Beacon call into its method, route and one chip per
 * parameter: pagination, granularity, each filter, and the
 * `requestParameters.expressionValue` fields.
 */
export function summarizeCall(
  call: Pick<RecordedCall, 'method' | 'path' | 'body'>
): CallSummary {
  const method = call.method === 'POST' ? 'POST' : 'GET'
  const { route, query } = splitPath(call.path)
  const chips: CallChip[] = []

  if (method === 'GET') {
    for (const key of ['skip', 'limit', 'requestedGranularity']) {
      const chip = paramChip(key, query.get(key))
      if (chip) chips.push(chip)
    }
    for (const id of (query.get('filters') ?? '').split(',')) {
      const text = id.trim()
      if (text) chips.push({ kind: 'ontology', label: text, title: text })
    }
    for (const [key, value] of query) {
      if (['skip', 'limit', 'requestedGranularity', 'filters'].includes(key)) continue
      const chip = paramChip(key, value)
      if (chip) chips.push(chip)
    }
    return { method, route, chips }
  }

  const body = (call.body ?? {}) as {
    query?: {
      requestedGranularity?: string
      pagination?: { skip?: number; limit?: number; nextPage?: string }
      filters?: Array<{ id?: string; operator?: string; value?: string }>
      requestParameters?: { expressionValue?: Record<string, unknown> }
    }
  }
  const q = body.query ?? {}
  const pagination = q.pagination ?? {}
  for (const [key, value] of [
    ['skip', pagination.skip],
    ['limit', pagination.limit],
    ['nextPage', pagination.nextPage],
  ] as const) {
    const chip = paramChip(key, value)
    if (chip) chips.push(chip)
  }
  const granularity = paramChip('requestedGranularity', q.requestedGranularity)
  if (granularity) chips.push(granularity)
  for (const filter of q.filters ?? []) chips.push(filterChip(filter))
  for (const [key, value] of Object.entries(q.requestParameters?.expressionValue ?? {})) {
    const chip = paramChip(key, value)
    if (chip) chips.push(chip)
  }
  return { method, route, chips }
}
