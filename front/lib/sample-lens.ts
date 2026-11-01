import { dedupeFilters } from '@/lib/beacon/filters'
import type { Biosample, FilteringTerm, UiFilter } from '@/lib/beacon/types'

export const SAMPLE_LENS_PAGE_SIZE = 5

/** Used when filtering_terms is empty (offline / loading). */
export const SAMPLE_LENS_QUERY_FALLBACK: Array<{ label: string; filter: UiFilter }> = [
  {
    label: 'liver',
    filter: { kind: 'ontology', id: 'UBERON:0002107', label: 'liver' },
  },
  {
    label: 'female reproductive system',
    filter: {
      kind: 'ontology',
      id: 'UBERON:0000474',
      label: 'female reproductive system',
    },
  },
  { label: 'female', filter: { kind: 'sex', value: 'female' } },
]

export function sampleLensQueryExamples(
  terms: FilteringTerm[]
): Array<{ label: string; filter: UiFilter }> {
  const examples: Array<{ label: string; filter: UiFilter }> = []
  const biosample = (term: FilteringTerm) =>
    term.scopes?.includes('biosample') ?? false

  const tissues = terms
    .filter((t) => biosample(t) && (t.type === 'UBERON' || t.type === 'EFO'))
    .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id))

  for (const term of tissues.slice(0, 3)) {
    examples.push({
      label: term.label ?? term.id,
      filter: { kind: 'ontology', id: term.id, label: term.label },
    })
  }

  const geo = terms.find((t) => t.id === 'GEO:sample' && biosample(t))
  if (geo) {
    examples.push({
      label: geo.label ?? 'GEO sample',
      filter: { kind: 'custom', id: 'GEO:sample', label: geo.label ?? 'GEO sample' },
    })
  }

  const sexTerm = terms.find((t) => t.id === 'sex' && biosample(t))
  if (sexTerm?.values?.includes('female')) {
    examples.push({ label: 'female', filter: { kind: 'sex', value: 'female' } })
  }

  const condition = terms.find((t) => t.id === 'condition' && biosample(t))
  const firstCondition = condition?.values?.[0]
  if (firstCondition) {
    examples.push({
      label: firstCondition,
      filter: {
        kind: 'alphanumeric',
        id: 'condition',
        value: firstCondition,
        label: `${condition?.label ?? 'condition'} = ${firstCondition}`,
      },
    })
  }

  const efoStatus = terms.find(
    (t) => biosample(t) && t.type === 'EFO' && t.id === 'EFO:0009655'
  )
  if (efoStatus) {
    examples.push({
      label: efoStatus.label ?? 'abnormal sample',
      filter: {
        kind: 'ontology',
        id: efoStatus.id,
        label: efoStatus.label,
      },
    })
  }

  const phenotype = terms.find(
    (t) =>
      biosample(t) &&
      (t.type === 'MONDO' || t.type === 'HP') &&
      t.id.includes(':')
  )
  if (phenotype) {
    examples.push({
      label: phenotype.label ?? phenotype.id,
      filter: {
        kind: 'ontology',
        id: phenotype.id,
        label: phenotype.label,
      },
    })
  }

  const rinAssay = terms.find(
    (t) => biosample(t) && t.type === 'NCIT' && t.id.startsWith('NCIT:')
  )
  if (rinAssay) {
    examples.push({
      label: rinAssay.label ?? rinAssay.id,
      filter: {
        kind: 'ontology',
        id: rinAssay.id,
        label: rinAssay.label,
      },
    })
  }

  if (!examples.length) return SAMPLE_LENS_QUERY_FALLBACK
  return examples.slice(0, 6)
}

function termLabel(term?: { id?: string; label?: string } | string | null): string | undefined {
  if (!term) return undefined
  if (typeof term === 'string') return term
  return term.label ?? term.id
}

export function biosampleStatusDisplay(sample: Biosample): {
  label: string
  id?: string
} {
  const st = sample.biosampleStatus
  if (!st) return { label: '—' }
  if (typeof st === 'string') return { label: st }
  return {
    label: st.label ?? st.id ?? '—',
    id: st.id,
  }
}

export function biosamplePhenotypeDisplay(sample: Biosample): string {
  const pf = sample.phenotypicFeatures?.[0]
  if (!pf) return '—'
  const disease = termLabel(pf.featureType)
  const sev = termLabel(pf.severity)
  const bits = [disease, sev].filter(Boolean)
  return bits.length ? bits.join(' · ') : '—'
}

export function mergeSampleLensFilters(current: UiFilter[], added: UiFilter): UiFilter[] {
  if (added.kind === 'sex') {
    return dedupeFilters([...current.filter((f) => f.kind !== 'sex'), added])
  }
  if (added.kind === 'alphanumeric') {
    return dedupeFilters([
      ...current.filter(
        (f) => !(f.kind === 'alphanumeric' && f.id === added.id)
      ),
      added,
    ])
  }
  return dedupeFilters([...current, added])
}

export function biosampleDisplayLabel(sample: Biosample): string {
  return (
    sample.sampleOriginDetail?.label ??
    sample.sampleType?.label ??
    sample.description?.trim() ??
    sample.id
  )
}

export function matrixCountForBiosample(sample: Biosample): number {
  return sample.matrixIds?.length ?? 0
}

export function resolveSelectedBiosample(
  matches: Biosample[],
  sampleParam: string | null
): Biosample | null {
  if (sampleParam) {
    return matches.find((s) => s.id === sampleParam) ?? null
  }
  if (matches.length === 1) return matches[0]
  return null
}
