import {
  COLOR_LOW,
  COLOR_MID,
  COLOR_MID_LOW,
  COLOR_MISSING,
  COLOR_TEXT_DARK,
  COLOR_TEXT_LIGHT,
  COLOR_TOP,
} from '@/components/heatmap-colors'

/**
 * Feature median-percentile thresholds (probe strongest first: 99 → 95 → 90).
 */
export const FEATURE_PERCENTILE_THRESHOLDS = [99, 95, 90] as const
export type FeaturePercentileThreshold =
  (typeof FEATURE_PERCENTILE_THRESHOLDS)[number]

/** Heatmap cell: feature percentile threshold, below-top-10%, or absent. */
export type BandCellValue = FeaturePercentileThreshold | 'none' | 'absent'

export const BAND_MATRIX_WINDOW_MAX = 24
/** Concurrent matrix-column fetches for band heatmaps. */
export const BAND_COLUMN_CONCURRENCY = 3

const FEATURE_PERCENTILE_LABELS: Record<FeaturePercentileThreshold, string> = {
  90: 'Top 10% of genes',
  95: 'Top 5% of genes',
  99: 'Top 1% of genes',
}

/** Alphanumeric Beacon filter for a median-percentile threshold. */
export function featurePercentileFilter(
  threshold: FeaturePercentileThreshold
): {
  kind: 'expression'
  id: 'expression.percentile'
  operator: '>='
  value: string
  label: string
} {
  return {
    kind: 'expression',
    id: 'expression.percentile',
    operator: '>=',
    value: String(threshold),
    label: FEATURE_PERCENTILE_LABELS[threshold],
  }
}

export function isFeaturePercentileThreshold(
  value: string | number
): value is FeaturePercentileThreshold {
  const n = typeof value === 'number' ? value : Number(value)
  return (FEATURE_PERCENTILE_THRESHOLDS as readonly number[]).includes(n)
}

export function bandLabel(band: BandCellValue): string {
  if (band === 'absent') return 'Not in matrix'
  if (band === 'none') return 'Below top 10%'
  if (band === 99) return 'Top 1% of genes'
  if (band === 95) return 'Top 5% of genes'
  if (band === 90) return 'Top 10% of genes'
  return String(band)
}

export function bandShortLabel(band: BandCellValue): string {
  if (band === 'absent') return '—'
  if (band === 'none') return '<90'
  if (band === 99) return '99'
  if (band === 95) return '95'
  if (band === 90) return '90'
  return String(band)
}

export function bandFill(band: BandCellValue): string {
  if (band === 'absent') return COLOR_MISSING
  if (band === 'none') return COLOR_LOW
  if (band === 90) return COLOR_MID_LOW
  if (band === 95) return COLOR_MID
  return COLOR_TOP
}

export function bandTextColor(band: BandCellValue): string {
  if (band === 'absent' || band === 'none' || band === 90) {
    return COLOR_TEXT_DARK
  }
  return COLOR_TEXT_LIGHT
}

/** Feature (median percentile threshold) legend entries. */
export const FEATURE_PERCENTILE_LEGEND: Array<{
  band: BandCellValue
  fill: string
}> = [
  { band: 'absent', fill: COLOR_MISSING },
  { band: 'none', fill: COLOR_LOW },
  { band: 90, fill: COLOR_MID_LOW },
  { band: 95, fill: COLOR_MID },
  { band: 99, fill: COLOR_TOP },
]

export function matrixIdsForEntities(
  entities: Array<{ matrixIds?: string[] }>,
  cap = BAND_MATRIX_WINDOW_MAX
): string[] {
  const ids = new Set<string>()
  for (const entity of entities) {
    for (const mid of entity.matrixIds ?? []) ids.add(mid)
  }
  return [...ids].sort((a, b) => a.localeCompare(b)).slice(0, cap)
}

export function bandCellKey(rowId: string, matrixId: string) {
  return `${rowId}\0${matrixId}`
}
