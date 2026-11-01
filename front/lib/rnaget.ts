export type Matrix = {
  matrixId: string
  name?: string
  expressionUnitAndScale?: { unit?: string; scale?: string }
  assembly?: { name?: string }
  dimensions?: { features?: number; biosamples?: number }
  assayType?: { label?: string }
}
export type Feature = {
  id: string
  genomicFeature?: {
    featureIdentifier?: { id?: string; resource?: string }
    featureType?: { id?: string; label?: string }
    aliases?: string[]
  }
  matrixIds?: string[]
}
export type OntologyTerm = { id?: string; label?: string }

export type Biosample = {
  id: string
  individualId?: string
  biosampleStatus?: string | OntologyTerm
  organism?: { scientificName?: string }
  collectionMoment?: string
  matrixIds?: string[]
  description?: string
  summary?: string
  notes?: string
  sampleOriginType?: OntologyTerm
  sampleType?: OntologyTerm
}
export type ExpressionValue = {
  id: string
  matrixId: string
  featureId: string
  biosampleId: string
  value: number
}

type Envelope<T> = {
  responseSummary?: { numTotalResults?: number }
  response?: { resultSets?: Array<{ results?: T[] }> }
}

/** Same-origin API behind nginx, or absolute URL for `next dev`. */
export function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (raw) return raw.replace(/\/$/, '')
  return '/rnaget-beacon/api'
}

function unwrap<T>(data: Envelope<T>) {
  const results = data.response?.resultSets?.[0]?.results ?? []
  return {
    results,
    total: data.responseSummary?.numTotalResults ?? results.length,
  }
}

function isSingleEntityPath(path: string): boolean {
  const raw = path.split('?')[0] ?? path
  return Boolean(
    raw.match(/\/matrices\/[^/]+$/) ||
      raw.match(/\/features\/[^/]+$/) ||
      raw.match(/\/biosamples\/[^/]+$/)
  )
}

export async function rnaget<T>(
  path: string
): Promise<{ results: T[]; total: number } | T> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`RNA-Get request failed (${response.status}) for ${path}`)
  }
  const data = (await response.json()) as Envelope<T>
  const page = unwrap<T>(data)
  if (isSingleEntityPath(path)) {
    if (!page.results[0]) {
      throw new Error(`Not found: ${path}`)
    }
    return page.results[0]
  }
  return page
}

export const listMatrices = (skip = 0, limit = 20) =>
  rnaget<Matrix>(`/matrices?skip=${skip}&limit=${limit}`) as Promise<{
    results: Matrix[]
    total: number
  }>

export const getMatrix = (id: string) =>
  rnaget<Matrix>(`/matrices/${encodeURIComponent(id)}`) as Promise<Matrix>

export const listFeatures = (skip = 0, limit = 20) =>
  rnaget<Feature>(`/features?skip=${skip}&limit=${limit}`) as Promise<{
    results: Feature[]
    total: number
  }>

export const getFeature = (id: string) =>
  rnaget<Feature>(`/features/${encodeURIComponent(id)}`) as Promise<Feature>

export const listBiosamples = (skip = 0, limit = 20) =>
  rnaget<Biosample>(`/biosamples?skip=${skip}&limit=${limit}`) as Promise<{
    results: Biosample[]
    total: number
  }>

export const getBiosample = (id: string) =>
  rnaget<Biosample>(
    `/biosamples/${encodeURIComponent(id)}`
  ) as Promise<Biosample>

export const listMatrixFeatures = (matrixId: string, skip = 0, limit = 20) =>
  rnaget<Feature>(
    `/matrices/${encodeURIComponent(matrixId)}/features?skip=${skip}&limit=${limit}`
  ) as Promise<{ results: Feature[]; total: number }>

export const listMatrixBiosamples = (matrixId: string, skip = 0, limit = 20) =>
  rnaget<Biosample>(
    `/matrices/${encodeURIComponent(matrixId)}/biosamples?skip=${skip}&limit=${limit}`
  ) as Promise<{ results: Biosample[]; total: number }>

export async function listExpressionValues(
  matrixId: string,
  params: URLSearchParams
): Promise<{ results: ExpressionValue[]; total: number }> {
  return rnaget<ExpressionValue>(
    `/matrices/${encodeURIComponent(matrixId)}/expression_values?${params}`
  ) as Promise<{ results: ExpressionValue[]; total: number }>
}

/** Known package matrix IDs for static `generateStaticParams` fallback. */
export const FALLBACK_MATRIX_IDS = [
  'ENCSR622FSM',
  'GSE164073',
  'GTEx-v8-Adipose-Subcutaneous',
]
