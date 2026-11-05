/**
 * Gene × tissue/cell heatmap bands for the Explore page.
 *
 * Band maps are supplied by Explore probe helpers (not on Feature records).
 *
 * `tissueHigh` / `tissueSpecific` filters remain package threshold 90.
 */

import {
  COLOR_LOW,
  COLOR_MISSING,
  COLOR_TEXT_DARK,
  COLOR_TEXT_LIGHT,
  COLOR_TOP,
} from '@/components/heatmap-colors'
import type { Feature } from '@/lib/beacon/types'
import type { FilteringTerm, UiFilter } from '@/lib/beacon/types'
import { isTissueOrCellOntologyId } from '@/lib/biosample-ontology-grid'
import { featureDisplayLabel } from '@/lib/gene-lens'

export const TISSUE_HIGH_PREFIX = 'tissueHigh:'
export const MATRIX_PSEUDO_PREFIX = 'matrix:'

/** Explore discrete cell band (not Features' absent/none vocabulary). */
export type TissueBand = 99 | 0 | 'none'

export type TissueColumn = {
  ontologyId: string
  label: string
  nBiosamples: number | null
}

/** Parse ``(n=235)`` from catalog labels like ``High in liver (n=235)``. */
export function parseTissueTermLabel(label: string | undefined): {
  name: string
  nBiosamples: number | null
} {
  const text = (label || '').trim()
  if (!text) return { name: '', nBiosamples: null }
  const match = text.match(/^(.*?)\s*\(n=(\d+)\)\s*$/i)
  if (!match) return { name: text, nBiosamples: null }
  return { name: match[1].trim(), nBiosamples: Number(match[2]) }
}

export function tissueOntologyFromHighId(id: string): string | null {
  const text = id.trim()
  if (!text.startsWith(TISSUE_HIGH_PREFIX)) return null
  const rest = text.slice(TISSUE_HIGH_PREFIX.length).trim()
  return rest || null
}

export function tissueHighFilterId(ontologyId: string): string {
  return `${TISSUE_HIGH_PREFIX}${ontologyId}`
}

export function isMatrixPseudoOntologyId(ontologyId: string): boolean {
  return ontologyId.startsWith(MATRIX_PSEUDO_PREFIX)
}

export function matrixIdFromPseudoOntology(ontologyId: string): string | null {
  if (!isMatrixPseudoOntologyId(ontologyId)) return null
  const mid = ontologyId.slice(MATRIX_PSEUDO_PREFIX.length).trim()
  return mid || null
}

/** Legacy columns from catalogued ``tissueHigh:`` terms (may be empty). */
export function tissueColumnsFromTerms(terms: FilteringTerm[]): TissueColumn[] {
  const out: TissueColumn[] = []
  const seen = new Set<string>()
  for (const term of terms) {
    if (term.type !== 'custom') continue
    const oid = tissueOntologyFromHighId(term.id)
    if (!oid || seen.has(oid)) continue
    if (!(term.scopes?.includes('genomicFeature') ?? false)) continue
    seen.add(oid)
    const { name, nBiosamples } = parseTissueTermLabel(term.label)
    const label =
      name.replace(/^High in\s+/i, '').trim() ||
      (isMatrixPseudoOntologyId(oid)
        ? `Unannotated (${matrixIdFromPseudoOntology(oid) ?? oid})`
        : oid)
    out.push({
      ontologyId: oid,
      label,
      nBiosamples,
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

function labelForOntologyId(
  ontologyId: string,
  terms: FilteringTerm[],
  fallbackLabel?: string
): string {
  const fromFilter = (fallbackLabel || '').trim()
  if (fromFilter) return fromFilter
  const hit = terms.find(
    (t) => t.id.trim().toLowerCase() === ontologyId.toLowerCase()
  )
  const fromTerm = (hit?.label || '').trim()
  if (fromTerm) return fromTerm
  if (isMatrixPseudoOntologyId(ontologyId)) {
    return `Unannotated (${matrixIdFromPseudoOntology(ontologyId) ?? ontologyId})`
  }
  return ontologyId
}

/** Columns from biosample-scope UBERON/EFO ontology terms in the catalog. */
export function tissueColumnsFromBiosampleOntologyTerms(
  terms: FilteringTerm[]
): TissueColumn[] {
  const out: TissueColumn[] = []
  const seen = new Set<string>()
  for (const term of terms) {
    const oid = (term.id || '').trim()
    if (!oid || !isTissueOrCellOntologyId(oid)) continue
    if (!(term.scopes?.includes('biosample') ?? false)) continue
    const key = oid.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      ontologyId: oid,
      label: labelForOntologyId(oid, terms, term.label),
      nBiosamples: null,
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/** Columns synthesized from active biosample tissue ontology filters. */
export function tissueColumnsFromActiveFilters(
  biosampleFilters: UiFilter[],
  terms: FilteringTerm[]
): TissueColumn[] {
  const out: TissueColumn[] = []
  const seen = new Set<string>()
  for (const filter of biosampleFilters) {
    if (filter.kind !== 'ontology') continue
    const oid = filter.id.trim()
    if (!isTissueOrCellOntologyId(oid)) continue
    const key = oid.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      ontologyId: oid,
      label: labelForOntologyId(oid, terms, filter.label),
      nBiosamples: null,
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

function mergeTissueColumns(...groups: TissueColumn[][]): TissueColumn[] {
  const byId = new Map<string, TissueColumn>()
  for (const group of groups) {
    for (const col of group) {
      const key = col.ontologyId.toLowerCase()
      const prev = byId.get(key)
      if (!prev) {
        byId.set(key, col)
        continue
      }
      byId.set(key, {
        ontologyId: prev.ontologyId,
        label: prev.label || col.label,
        nBiosamples:
          prev.nBiosamples != null ? prev.nBiosamples : col.nBiosamples,
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Restrict columns when the user has biosample UBERON/EFO filters.
 * Feature-scope tissueHigh chips do not cut columns (so specificity stays visible).
 */
export function filterTissueColumns(
  columns: TissueColumn[],
  biosampleFilters: UiFilter[]
): TissueColumn[] {
  const ontologyIds = new Set<string>()
  for (const filter of biosampleFilters) {
    if (filter.kind === 'ontology' && isTissueOrCellOntologyId(filter.id)) {
      ontologyIds.add(filter.id)
    }
  }
  if (!ontologyIds.size) return columns
  const lower = new Set([...ontologyIds].map((id) => id.toLowerCase()))
  return columns.filter((col) => lower.has(col.ontologyId.toLowerCase()))
}

/**
 * Explore column universe: biosample UBERON/EFO catalog (+ legacy tissueHigh),
 * narrowed to active tissue filters, synthesizing those filters when needed.
 */
export function exploreTissueColumnUniverse(
  terms: FilteringTerm[],
  biosampleFilters: UiFilter[]
): TissueColumn[] {
  const fromCatalog = tissueColumnsFromBiosampleOntologyTerms(terms)
  const fromLegacyHigh = tissueColumnsFromTerms(terms)
  const base = mergeTissueColumns(fromCatalog, fromLegacyHigh)
  const tissueSelectors = biosampleFilters.filter(
    (f) => f.kind === 'ontology' && isTissueOrCellOntologyId(f.id)
  )
  if (!tissueSelectors.length) return base
  const narrowed = filterTissueColumns(base, tissueSelectors)
  if (narrowed.length) return narrowed
  return tissueColumnsFromActiveFilters(tissueSelectors, terms)
}

export function tissueBandFromInfo(
  bands: Record<string, number> | undefined,
  ontologyId: string
): TissueBand {
  if (!bands) return 'none'
  const raw = bands[ontologyId]
  if (raw == null) {
    const hit = Object.entries(bands).find(
      ([key]) => key.toLowerCase() === ontologyId.toLowerCase()
    )
    if (!hit) return 'none'
    return Number(hit[1]) === 99 ? 99 : 0
  }
  return Number(raw) === 99 ? 99 : 0
}

export function tissueBandLabel(band: TissueBand): string {
  if (band === 'none') return 'Not in matrix'
  if (band === 0) return '<99'
  return '≥99'
}

export function tissueBandShortLabel(band: TissueBand): string {
  if (band === 'none') return '—'
  if (band === 0) return '<99'
  return '99'
}

export function tissueBandFill(band: TissueBand): string {
  if (band === 'none') return COLOR_MISSING
  if (band === 0) return COLOR_LOW
  return COLOR_TOP
}

export function tissueBandTextColor(band: TissueBand): string {
  if (band === 'none' || band === 0) return COLOR_TEXT_DARK
  return COLOR_TEXT_LIGHT
}

export const TISSUE_BAND_LEGEND: Array<{
  band: TissueBand
  fill: string
}> = [
  { band: 'none', fill: COLOR_MISSING },
  { band: 0, fill: COLOR_LOW },
  { band: 99, fill: COLOR_TOP },
]

/** Sort rank: ≥99 first, then <99, then none. */
export function tissueBandSortRank(band: TissueBand): number {
  if (band === 99) return 0
  if (band === 0) return 1
  return 2
}

/** Sort features for a focused tissue column (stable by display label). */
export function sortFeaturesByTissueBand(
  features: Feature[],
  ontologyId: string,
  tissueBandsFor: (feature: Feature) => Record<string, number> | undefined = () =>
    undefined
): Feature[] {
  return [...features].sort((a, b) => {
    const bandA = tissueBandFromInfo(tissueBandsFor(a), ontologyId)
    const bandB = tissueBandFromInfo(tissueBandsFor(b), ontologyId)
    const rank = tissueBandSortRank(bandA) - tissueBandSortRank(bandB)
    if (rank !== 0) return rank
    return featureDisplayLabel(a).localeCompare(featureDisplayLabel(b))
  })
}
