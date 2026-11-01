import { dedupeFilters } from '@/lib/beacon/filters'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'
import { nativeFeatureId } from '@/lib/heatmap-expression'

/** One-click starter queries on the gene lens (not applied until selected). */
export const GENE_LENS_QUERY_EXAMPLES: Array<{ label: string; filter: UiFilter }> = [
  { label: 'TP53', filter: { kind: 'symbol', value: 'TP53' } },
  { label: 'ALB', filter: { kind: 'symbol', value: 'ALB' } },
  { label: 'TP53 · HGNC:11998', filter: { kind: 'ontology', id: 'HGNC:11998', label: 'TP53' } },
  { label: 'BRCA1 · HGNC:1100', filter: { kind: 'ontology', id: 'HGNC:1100', label: 'BRCA1' } },
  { label: 'EGFR · HGNC:3236', filter: { kind: 'ontology', id: 'HGNC:3236', label: 'EGFR' } },
]

export const GENE_LENS_PAGE_SIZE = 5

export function geneLensQueryExamples(
  terms: FilteringTerm[]
): Array<{ label: string; filter: UiFilter }> {
  const base = [...GENE_LENS_QUERY_EXAMPLES]
  const featureScope = (term: FilteringTerm) =>
    term.scopes?.includes('genomicFeature') ?? false
  const go = terms.find(
    (t) => featureScope(t) && t.type === 'GO' && t.id.startsWith('GO:')
  )
  if (go) {
    base.push({
      label: go.label ?? go.id,
      filter: { kind: 'ontology', id: go.id, label: go.label },
    })
  }
  return base.slice(0, 7)
}

export function mergeGeneLensFilters(current: UiFilter[], added: UiFilter): UiFilter[] {
  return dedupeFilters([...current, added])
}

export function featureDisplayLabel(feature: Feature): string {
  return (
    feature.genomicFeature?.aliases?.[0] ??
    feature.genomicFeature?.featureIdentifier?.id ??
    feature.id
  )
}

export function featureNativeToken(feature: Feature): string {
  return nativeFeatureId(feature)
}

export function featureAnnotationResource(feature: Feature): string | undefined {
  return feature.genomicFeature?.featureIdentifier?.resource
}

export function matrixCountForFeature(feature: Feature): number {
  return feature.matrixIds?.length ?? 0
}

/** Matrix workspace URL with optional feature row/cohort pre-selected. */
export function matrixViewHref(matrixId: string, feature?: Feature | null): string {
  const params = new URLSearchParams()
  if (feature) {
    params.set('featureIds', feature.id)
    const gene =
      feature.genomicFeature?.aliases?.[0] ??
      feature.genomicFeature?.featureIdentifier?.id
    if (gene) params.set('genes', gene)
  }
  const enc = encodeURIComponent(matrixId)
  const qs = params.toString()
  return qs ? `/matrices/${enc}/?${qs}` : `/matrices/${enc}/`
}

export function summariesByMatrixId(
  rows: ExpressionSummary[]
): Record<string, ExpressionSummary[]> {
  return rows.reduce<Record<string, ExpressionSummary[]>>((acc, row) => {
    const mid = row.matrixId ?? ''
    acc[mid] = acc[mid] ?? []
    acc[mid].push(row)
    return acc
  }, {})
}

export function matrixIdsFromSummaries(rows: ExpressionSummary[]): string[] {
  return [...new Set(rows.map((r) => r.matrixId).filter(Boolean) as string[])]
}

export function resolveSelectedFeature(
  matches: Feature[],
  featureParam: string | null
): Feature | null {
  if (featureParam) {
    return matches.find((f) => f.id === featureParam) ?? null
  }
  if (matches.length === 1) return matches[0]
  return null
}

/** Prefer whole-matrix summary row when grouped summaries exist. */
export function primarySummaryForMatrix(rows: ExpressionSummary[]): ExpressionSummary | undefined {
  if (!rows.length) return undefined
  const whole =
    rows.find((r) => !r.group?.id && !r.group?.label) ??
    rows.find((r) => r.group?.label?.toLowerCase() === 'all')
  return whole ?? rows[0]
}

export function medianForMatrix(rows: ExpressionSummary[]): number | undefined {
  return primarySummaryForMatrix(rows)?.median
}
