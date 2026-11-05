import {
  dedupeFilters,
  isMatrixProfileSourceFilterId,
  matrixProfileSourceCustomFilter,
} from '@/lib/beacon/filters'
import { catalogValueDisplayLabel } from '@/lib/lens-catalog'
import type { FilteringTerm, Matrix, UiFilter } from '@/lib/beacon/types'

export const MATRIX_LENS_PAGE_SIZE = 5

export const MATRIX_LENS_QUERY_FALLBACK: Array<{ label: string; filter: UiFilter }> = [
  {
    label: 'TPM',
    filter: { kind: 'alphanumeric', id: 'matrix.unit', value: 'TPM', label: 'unit = TPM' },
  },
  {
    label: 'bulk RNA-seq assay',
    filter: { kind: 'ontology', id: 'OBI:0003090', label: 'bulk RNA-seq assay' },
  },
]

function matrixScope(term: FilteringTerm) {
  return term.scopes?.includes('matrix') ?? false
}

function pushAlphanumeric(
  examples: Array<{ label: string; filter: UiFilter }>,
  term: FilteringTerm | undefined,
  value: string,
  label: string
) {
  if (!term?.values?.includes(value)) return
  examples.push({
    label,
    filter: {
      kind: 'alphanumeric',
      id: term.id,
      value,
      label: `${term.label ?? term.id} = ${value}`,
    },
  })
}

export function matrixLensQueryExamples(
  terms: FilteringTerm[]
): Array<{ label: string; filter: UiFilter }> {
  const examples: Array<{ label: string; filter: UiFilter }> = []

  const unitTerm = terms.find((t) => t.id === 'matrix.unit' && matrixScope(t))
  pushAlphanumeric(examples, unitTerm, 'TPM', 'TPM')

  const profile = terms.find((t) => t.id === 'matrix.profileSource' && matrixScope(t))
  if (profile?.values?.includes('gtex')) {
    examples.push({
      label: catalogValueDisplayLabel('matrix.profileSource', 'gtex'),
      filter: matrixProfileSourceCustomFilter(
        'gtex',
        `${profile.label ?? 'profileSource'} = ${catalogValueDisplayLabel('matrix.profileSource', 'gtex')}`
      ),
    })
  }
  if (profile?.values?.includes('geo')) {
    examples.push({
      label: catalogValueDisplayLabel('matrix.profileSource', 'geo'),
      filter: matrixProfileSourceCustomFilter(
        'geo',
        `${profile.label ?? 'profileSource'} = ${catalogValueDisplayLabel('matrix.profileSource', 'geo')}`
      ),
    })
  }

  const obi = terms.find((t) => matrixScope(t) && t.id === 'OBI:0003090')
  if (obi) {
    examples.push({
      label: obi.label ?? 'bulk RNA-seq assay',
      filter: { kind: 'ontology', id: obi.id, label: obi.label },
    })
  }

  const assembly = terms.find((t) => t.id === 'matrix.assembly.name' && matrixScope(t))
  const grch = assembly?.values?.find((v) => v.toUpperCase().startsWith('GRCH38'))
  if (assembly && grch) {
    examples.push({
      label: grch,
      filter: {
        kind: 'alphanumeric',
        id: assembly.id,
        value: grch,
        label: `assembly = ${grch}`,
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
  if (added.kind === 'custom' && isMatrixProfileSourceFilterId(added.id)) {
    return dedupeFilters([
      ...current.filter(
        (f) => !(f.kind === 'custom' && isMatrixProfileSourceFilterId(f.id))
      ),
      added,
    ])
  }
  return dedupeFilters([...current, added])
}

export function matrixDisplayLabel(matrix: Matrix): string {
  return matrix.name?.trim() || matrix.matrixId
}
