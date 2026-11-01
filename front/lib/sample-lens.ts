import { dedupeFilters, filterKey, matrixHref } from '@/lib/beacon/filters'
import type { Biosample, FilteringTerm, OntologyTerm, UiFilter } from '@/lib/beacon/types'

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

  const seen = new Set<string>()
  const unique = examples.filter((ex) => {
    const key = filterKey(ex.filter)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.slice(0, 6)
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

export type BiosampleHeatmapColumnHeader = {
  title: string
  subtitle?: string
  tooltip: string
  subtitleIsId: boolean
}

function defaultTitleCandidate(sample: Biosample): string {
  const detail = termLabel(sample.sampleOriginDetail)
  if (detail) return detail
  const type = termLabel(sample.sampleType)
  if (type) return type
  const desc = sample.description?.trim() || sample.summary?.trim()
  if (desc) return desc
  return biosampleDisplayLabel(sample)
}

function specificTitle(sample: Biosample): string {
  const display = biosampleDisplayLabel(sample)
  if (display && display !== sample.id) return display
  const desc = sample.description?.trim() || sample.summary?.trim()
  if (desc) return desc
  return sample.id
}

function coarsePeerKey(sample: Biosample): string {
  const origin = termLabel(sample.sampleOriginType)
  if (origin) return `origin:${origin}`
  const title = defaultTitleCandidate(sample)
  return `title:${title}`
}

function peersNeedSpecificTitles(peers: Biosample[]): boolean {
  if (peers.length < 2) return false
  const titleCounts = new Map<string, number>()
  const coarseCounts = new Map<string, number>()
  for (const peer of peers) {
    const title = defaultTitleCandidate(peer)
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
    const coarse = coarsePeerKey(peer)
    coarseCounts.set(coarse, (coarseCounts.get(coarse) ?? 0) + 1)
  }
  for (const count of titleCounts.values()) {
    if (count >= 2) return true
  }
  for (const count of coarseCounts.values()) {
    if (count >= 2) return true
  }
  return false
}

function titleUsesDetailOrType(sample: Biosample, title: string): boolean {
  const detail = termLabel(sample.sampleOriginDetail)
  if (detail && detail === title) return true
  const type = termLabel(sample.sampleType)
  if (type && type === title) return true
  return false
}

function pickSubtitle(sample: Biosample, title: string): { text?: string; isId: boolean } {
  const norm = (s: string) => s.trim().toLowerCase()
  const titleNorm = norm(title)

  const id = sample.id?.trim()
  if (id && norm(id) !== titleNorm) {
    return { text: id.length > 22 ? `${id.slice(0, 20)}…` : id, isId: true }
  }

  const sex = sample.sex ?? sample.info?.sex
  if (sex != null) {
    const s = String(sex)
    if (norm(s) !== titleNorm) return { text: s, isId: false }
  }

  const info = sample.info
  for (const value of [info?.condition, info?.timepoint, info?.lab]) {
    if (value != null) {
      const s = String(value).trim()
      if (s && norm(s) !== titleNorm) return { text: s, isId: false }
    }
  }

  const phenotype = biosamplePhenotypeDisplay(sample)
  if (phenotype !== '—' && norm(phenotype) !== titleNorm) {
    return { text: phenotype, isId: false }
  }

  const origin = termLabel(sample.sampleOriginType)
  if (origin && titleUsesDetailOrType(sample, title) && norm(origin) !== titleNorm) {
    return { text: origin, isId: false }
  }

  return { isId: false }
}

function buildTooltip(sample: Biosample, title: string, subtitle?: string): string {
  const lines: string[] = []
  if (title) lines.push(title)
  if (subtitle && subtitle !== title) lines.push(subtitle)
  if (sample.id) lines.push(sample.id)
  const originType = termLabel(sample.sampleOriginType)
  const originDetail = termLabel(sample.sampleOriginDetail)
  if (originType && originType !== title && originType !== subtitle) {
    lines.push(`Origin: ${originType}`)
  }
  if (originDetail && originDetail !== title && originDetail !== subtitle) {
    lines.push(`Detail: ${originDetail}`)
  }
  const status = biosampleStatusDisplay(sample)
  if (status.label && status.label !== '—') lines.push(`Status: ${status.label}`)
  const phenotype = biosamplePhenotypeDisplay(sample)
  if (phenotype !== '—' && phenotype !== subtitle) lines.push(`Phenotype: ${phenotype}`)
  return [...new Set(lines)].join('\n')
}

/** Column header for matrix heatmap; pass visible page peers for de-duplication. */
export function biosampleHeatmapColumnHeader(
  sample: Biosample,
  peers: Biosample[]
): BiosampleHeatmapColumnHeader {
  const useSpecific = peersNeedSpecificTitles(peers)
  const title = useSpecific ? specificTitle(sample) : defaultTitleCandidate(sample)
  const { text: subtitle, isId } = pickSubtitle(sample, title)
  return {
    title,
    subtitle,
    tooltip: buildTooltip(sample, title, subtitle),
    subtitleIsId: Boolean(subtitle && isId),
  }
}

export function matrixCountForBiosample(sample: Biosample): number {
  return sample.matrixIds?.length ?? 0
}

/** Matrix workspace to open, preferring the lens matrix scope when set. */
export function preferredMatrixIdForBiosample(
  sample: Biosample,
  focusMatrix: string | null
): string | null {
  if (focusMatrix) return focusMatrix
  const ids = sample.matrixIds
  return ids?.[0] ?? null
}

export function biosampleMatrixHeatmapHref(sampleId: string, matrixId: string): string {
  return matrixHref(matrixId, `biosampleIds=${encodeURIComponent(sampleId)}`)
}

function ontologyChipLabel(term: OntologyTerm | string | undefined): string | null {
  if (!term) return null
  if (typeof term === 'string') return term.trim() || null
  return term.label?.trim() || term.id?.trim() || null
}

export function biosampleResultChipTerms(sample: Biosample): Array<{
  key: string
  label: string
  title?: string
  accent?: boolean
}> {
  const chips: Array<{ key: string; label: string; title?: string; accent?: boolean }> = []
  const pushTerm = (key: string, term: OntologyTerm | string | undefined, accent = false) => {
    const label = ontologyChipLabel(term)
    if (!label) return
    const id = typeof term === 'object' ? term?.id : undefined
    chips.push({ key, label, title: id, accent })
  }

  pushTerm('status', sample.biosampleStatus, true)
  pushTerm('type', sample.sampleType, true)
  pushTerm('origin', sample.sampleOriginDetail ?? sample.sampleOriginType)
  pushTerm('processing', sample.sampleProcessing)

  const sex = sample.sex ?? sample.info?.sex
  if (sex) chips.push({ key: 'sex', label: String(sex), accent: true })

  const pf = sample.phenotypicFeatures?.[0]
  if (pf?.featureType) pushTerm('phenotype', pf.featureType)
  if (pf?.severity) pushTerm('severity', pf.severity)

  const n = matrixCountForBiosample(sample)
  if (n > 0) {
    chips.push({
      key: 'matrices',
      label: n === 1 ? '1 matrix' : `${n} matrices`,
    })
  }

  return chips
}

