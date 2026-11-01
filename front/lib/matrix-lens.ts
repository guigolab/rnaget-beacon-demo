import { dedupeFilters } from '@/lib/beacon/filters'
import type { FilteringTerm, Matrix, UiFilter } from '@/lib/beacon/types'

export const MATRIX_LENS_PAGE_SIZE = 5

export const MATRIX_LENS_QUERY_FALLBACK: Array<{ label: string; filter: UiFilter }> = [
  {
    label: 'TPM',
    filter: { kind: 'alphanumeric', id: 'matrix.unit', value: 'TPM', label: 'unit = TPM' },
  },
  {
    label: 'gene (SO)',
    filter: { kind: 'ontology', id: 'SO:0000704', label: 'gene' },
  },
  {
    label: 'bulk RNA-seq assay',
    filter: { kind: 'ontology', id: 'OBI:0003090', label: 'bulk RNA-seq assay' },
  },
]

export function matrixLensQueryExamples(
  terms: FilteringTerm[]
): Array<{ label: string; filter: UiFilter }> {
  const examples: Array<{ label: string; filter: UiFilter }> = []
  const matrixScope = (term: FilteringTerm) => term.scopes?.includes('matrix') ?? false

  const unitTerm = terms.find((t) => t.id === 'matrix.unit' && matrixScope(t))
  const tpm = unitTerm?.values?.find((v) => v.toUpperCase() === 'TPM') ?? unitTerm?.values?.[0]
  if (tpm) {
    examples.push({
      label: tpm,
      filter: {
        kind: 'alphanumeric',
        id: 'matrix.unit',
        value: tpm,
        label: `unit = ${tpm}`,
      },
    })
  }

  const obi = terms
    .filter((t) => matrixScope(t) && t.type === 'OBI')
    .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id))
  for (const term of obi.slice(0, 2)) {
    examples.push({
      label: term.label ?? term.id,
      filter: { kind: 'ontology', id: term.id, label: term.label },
    })
  }

  const so = terms
    .filter((t) => matrixScope(t) && t.type === 'SO')
    .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id))
  for (const term of so.slice(0, 1)) {
    examples.push({
      label: term.label ?? term.id,
      filter: { kind: 'ontology', id: term.id, label: term.label },
    })
  }

  const profile = terms.find((t) => t.id === 'matrix.profileSource' && matrixScope(t))
  const src = profile?.values?.[0]
  if (src) {
    examples.push({
      label: src,
      filter: {
        kind: 'alphanumeric',
        id: 'matrix.profileSource',
        value: src,
        label: `profile = ${src}`,
      },
    })
  }

  const repro = terms.find((t) => t.id === 'matrix.reproducible' && matrixScope(t))
  if (repro?.values?.includes('true')) {
    examples.push({
      label: 'Reproducible',
      filter: {
        kind: 'alphanumeric',
        id: 'matrix.reproducible',
        value: 'true',
        label: 'Reproducible quantification = true',
      },
    })
  }

  if (!examples.length) return MATRIX_LENS_QUERY_FALLBACK
  return examples.slice(0, 6)
}

export function mergeMatrixLensFilters(current: UiFilter[], added: UiFilter): UiFilter[] {
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

export function matrixDisplayLabel(matrix: Matrix): string {
  return matrix.name ?? matrix.matrixId ?? 'Matrix'
}
