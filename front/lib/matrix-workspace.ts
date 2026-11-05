import { FEATURE_BIOTYPE_FAMILY_ID } from '@/lib/beacon/filters'
import {
  isTissueOrCellType,
  ONTOLOGY_CORE_TISSUES,
} from '@/lib/biosample-ontology-grid'
import { featureSymbol } from '@/lib/gene-lens'
import type { Feature, FilteringTerm, UiFilter } from '@/lib/beacon/types'

const CORE_TISSUES = ONTOLOGY_CORE_TISSUES

const PINNED_CAP = 3

export type MatrixExample = { label: string; filter: UiFilter }

export type MatrixExampleSet = {
  pinned: MatrixExample[]
  more: MatrixExample[]
}

function exampleKey(example: MatrixExample): string {
  const f = example.filter
  if (f.kind === 'symbol') return `symbol:${f.value}`
  if (f.kind === 'alphanumeric') return `alphanumeric:${f.id}:${f.value}`
  if (f.kind === 'expression') {
    return `expression:${f.id}:${f.operator ?? ''}:${f.value ?? ''}`
  }
  if (f.kind === 'matrixUnit') return `matrixUnit:${f.value}`
  return `${f.kind}:${f.id}`
}

function pushUnique(
  examples: MatrixExample[],
  example: MatrixExample,
  seen: Set<string>
) {
  const key = exampleKey(example)
  if (seen.has(key)) return
  seen.add(key)
  examples.push(example)
}

function splitPinnedMore(candidates: MatrixExample[]): MatrixExampleSet {
  return {
    pinned: candidates.slice(0, PINNED_CAP),
    more: candidates.slice(PINNED_CAP),
  }
}

function pushOntology(
  examples: MatrixExample[],
  term: FilteringTerm,
  seen: Set<string>
) {
  pushUnique(
    examples,
    {
      label: term.label ?? term.id,
      filter: { kind: 'ontology', id: term.id, label: term.label },
    },
    seen
  )
}

/** Example chips drawn only from this matrix: symbols + biotype + expression story. */
export function matrixHeatmapFeatureExamples(
  terms: FilteringTerm[],
  previewFeatures: Feature[]
): MatrixExampleSet {
  const candidates: MatrixExample[] = []
  const seen = new Set<string>()

  for (const feature of previewFeatures) {
    const symbol = featureSymbol(feature)
    if (!symbol) continue
    pushUnique(
      candidates,
      {
        label: symbol,
        filter: { kind: 'custom', id: `symbol:${symbol}`, label: symbol },
      },
      seen
    )
  }

  const biotype = terms.find(
    (term) =>
      term.id === FEATURE_BIOTYPE_FAMILY_ID &&
      (term.values?.includes('protein_coding') ?? false)
  )
  if (biotype) {
    pushUnique(
      candidates,
      {
        label: 'Protein-coding',
        filter: {
          kind: 'alphanumeric',
          id: FEATURE_BIOTYPE_FAMILY_ID,
          value: 'protein_coding',
          label: 'Gene type = protein_coding',
        },
      },
      seen
    )
  }

  const pctTerm = terms.find((t) => t.id === 'expression.percentile')
  const pctValues = new Set(pctTerm?.values ?? [])
  // Prefer strongest threshold first so it can land in pinned when symbols are few.
  for (const [value, label] of [
    ['99', 'Top 1% of genes'],
    ['95', 'Top 5% of genes'],
    ['90', 'Top 10% of genes'],
  ] as const) {
    if (!pctValues.has(value)) continue
    pushUnique(
      candidates,
      {
        label,
        filter: {
          kind: 'expression',
          id: 'expression.percentile',
          operator: '>=',
          value,
          label,
        },
      },
      seen
    )
  }

  return splitPinnedMore(candidates)
}

/** Example chips drawn only from this matrix's biosample terms. */
export function matrixHeatmapBiosampleExamples(
  terms: FilteringTerm[]
): MatrixExampleSet {
  const candidates: MatrixExample[] = []
  const seen = new Set<string>()
  const biosample = (term: FilteringTerm) => term.scopes?.includes('biosample') ?? false

  for (const id of CORE_TISSUES) {
    const term = terms.find((t) => biosample(t) && t.id === id)
    if (term) pushOntology(candidates, term, seen)
  }

  const tissues = terms
    .filter(isTissueOrCellType)
    .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id))
  for (const term of tissues) {
    pushOntology(candidates, term, seen)
  }

  return splitPinnedMore(candidates)
}
