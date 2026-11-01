import { featureSymbol } from '@/lib/gene-lens'
import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'

const PREFERRED_FEATURE_TYPES = ['SO:0001217', 'SO:0002127']
const SAMPLE_STATUS_IDS = new Set(['EFO:0009654', 'EFO:0009655'])

export function matrixHeatmapFilteringTermsPath(
  matrixId: string,
  axis: 'features' | 'biosamples'
): string {
  const enc = encodeURIComponent(matrixId)
  return axis === 'features'
    ? `/matrices/${enc}/features/filtering_terms`
    : `/matrices/${enc}/biosamples/filtering_terms`
}

function pushOntology(
  examples: Array<{ label: string; filter: UiFilter }>,
  term: FilteringTerm
) {
  if (examples.some((example) => example.filter.kind === 'ontology' && example.filter.id === term.id)) {
    return
  }
  examples.push({
    label: term.label ?? term.id,
    filter: { kind: 'ontology', id: term.id, label: term.label },
  })
}

/** Example chips drawn only from this matrix: two symbols and up to two biotypes. */
export function matrixHeatmapFeatureExamples(
  terms: FilteringTerm[],
  previewFeatures: Feature[]
): Array<{ label: string; filter: UiFilter }> {
  const examples: Array<{ label: string; filter: UiFilter }> = []
  const seen = new Set<string>()

  for (const feature of previewFeatures) {
    if (examples.length >= 2) break
    const symbol = featureSymbol(feature)
    if (!symbol) continue
    const key = symbol.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    examples.push({ label: symbol, filter: { kind: 'symbol', value: symbol } })
  }

  const biotypes = terms.filter(
    (term) =>
      term.type === 'SO' &&
      term.id !== 'SO:0000704' &&
      (term.scopes?.includes('genomicFeature') ?? true)
  )
  const preferred = PREFERRED_FEATURE_TYPES.flatMap((id) => {
    const term = biotypes.find((item) => item.id === id)
    return term ? [term] : []
  })
  const rest = biotypes.filter((term) => !PREFERRED_FEATURE_TYPES.includes(term.id))
  let biotypeCount = 0
  for (const term of [...preferred, ...rest]) {
    if (biotypeCount >= 2) break
    pushOntology(examples, term)
    biotypeCount += 1
  }

  return examples
}

function isTissueOrCellType(term: FilteringTerm): boolean {
  if (term.type !== 'UBERON' && term.type !== 'EFO') return false
  if (SAMPLE_STATUS_IDS.has(term.id)) return false
  return term.scopes?.includes('biosample') ?? false
}

/** Example chips drawn only from this matrix's biosample terms. */
export function matrixHeatmapBiosampleExamples(
  terms: FilteringTerm[]
): Array<{ label: string; filter: UiFilter }> {
  const examples: Array<{ label: string; filter: UiFilter }> = []
  const biosample = (term: FilteringTerm) => term.scopes?.includes('biosample') ?? false

  const tissues = terms
    .filter(isTissueOrCellType)
    .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id))
  for (const term of tissues.slice(0, 2)) pushOntology(examples, term)

  const sexTerm = terms.find((term) => term.id === 'sex' && biosample(term))
  const sexValue = sexTerm?.values?.[0]
  if (sexValue) {
    examples.push({ label: sexValue, filter: { kind: 'sex', value: sexValue } })
  }

  const condition = terms.find((term) => term.id === 'condition' && biosample(term))
  const conditionValue = condition?.values?.[0]
  if (conditionValue) {
    examples.push({
      label: conditionValue,
      filter: {
        kind: 'alphanumeric',
        id: 'condition',
        value: conditionValue,
        label: `${condition?.label ?? 'condition'} = ${conditionValue}`,
      },
    })
  }

  return examples.slice(0, 4)
}
