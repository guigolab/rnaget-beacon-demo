import {
  dedupeFilters,
  FEATURE_BIOTYPE_FAMILY_ID,
  symbolCustomFilter,
} from '@/lib/beacon/filters'
import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'

export const GENE_LENS_PAGE_SIZE = 5

export function geneLensQueryExamples(
  terms: FilteringTerm[]
): Array<{ label: string; filter: UiFilter }> {
  const examples: Array<{ label: string; filter: UiFilter }> = [
    { label: 'TP53', filter: symbolCustomFilter('TP53') },
  ]

  const biotype = terms.find(
    (term) =>
      term.id === FEATURE_BIOTYPE_FAMILY_ID &&
      (term.scopes?.includes('genomicFeature') ?? false) &&
      (term.values?.includes('protein_coding') ?? false)
  )
  if (biotype) {
    examples.push({
      label: 'Protein-coding',
      filter: {
        kind: 'alphanumeric',
        id: FEATURE_BIOTYPE_FAMILY_ID,
        value: 'protein_coding',
        label: 'Gene type = protein_coding',
      },
    })
  }

  const pctTerm = terms.find(
    (t) =>
      t.id === 'expression.percentile' &&
      (t.scopes?.includes('genomicFeature') ?? false)
  )
  const pctValues = new Set(pctTerm?.values ?? [])
  if (pctValues.has('90')) {
    examples.push({
      label: 'Top 10% of genes',
      filter: {
        kind: 'expression',
        id: 'expression.percentile',
        operator: '>=',
        value: '90',
        label: 'Top 10% of genes',
      },
    })
  }
  if (pctValues.has('99')) {
    examples.push({
      label: 'Top 1% of genes',
      filter: {
        kind: 'expression',
        id: 'expression.percentile',
        operator: '>=',
        value: '99',
        label: 'Top 1% of genes',
      },
    })
  }

  return examples.slice(0, 6)
}

export function mergeGeneLensFilters(current: UiFilter[], added: UiFilter): UiFilter[] {
  return dedupeFilters([...current, added])
}

/** Ensembl / RefSeq accessions and bare numeric gene ids are not symbols. */
const ACCESSION_ALIAS = /^(ENS(?:G|T|P|MUSG|MUST)\d|NM_|NR_|NP_|XM_|XR_|XP_)/i

export function isAccessionAlias(value: string): boolean {
  const text = value.trim()
  if (!text || /^\d+$/.test(text)) return true
  return ACCESSION_ALIAS.test(text)
}

/** First human-readable alias, skipping accessions that are stored ahead of the symbol. */
export function featureSymbol(feature: Feature): string | undefined {
  for (const alias of feature.aliases ?? []) {
    const text = alias.trim()
    if (text && !isAccessionAlias(text)) return text
  }
  return undefined
}

export function featureDisplayLabel(feature: Feature): string {
  return (
    featureSymbol(feature) ??
    feature.featureIdentifier?.id ??
    feature.id
  )
}

export function featureAnnotationResource(feature: Feature): string | undefined {
  return feature.featureIdentifier?.resource
}

export function matrixCountForFeature(feature: Feature): number {
  return feature.matrixIds?.length ?? 0
}

/** Matrix workspace URL with optional feature row/cohort pre-selected. */
export function matrixViewHref(matrixId: string, feature?: Feature | null): string {
  const params = new URLSearchParams()
  if (feature) {
    // Prefer native accession — matches expressionValue.featureId / slice stubs.
    const native =
      feature.featureIdentifier?.id?.trim() || feature.id
    params.set('featureIds', native)
    const gene = featureSymbol(feature)
    if (gene) params.set('genes', gene)
  }
  const enc = encodeURIComponent(matrixId)
  const qs = params.toString()
  return qs ? `/matrices/${enc}/?${qs}` : `/matrices/${enc}/`
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
