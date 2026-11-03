import {
  COLOR_HIGH,
  COLOR_LOW,
  COLOR_MID,
  COLOR_MID_LOW,
  COLOR_MISSING,
  COLOR_TEXT_DARK,
  COLOR_TEXT_LIGHT,
  COLOR_TOP,
} from '@/components/heatmap-colors'

/**
 * Precomputed expression / detected-genes percentile bands (quintiles of
 * median / detected_genes among detected entities, plus none).
 */
export const EXPRESSION_BANDS = [
  'none',
  '0-20',
  '20-40',
  '40-60',
  '60-80',
  '80-100',
] as const
export type ExpressionBand = (typeof EXPRESSION_BANDS)[number]

/** Heatmap cell: band, or not a member of that matrix. */
export type BandCellValue = ExpressionBand | 'absent'

export const BAND_MATRIX_WINDOW_MAX = 24
export const BAND_ROW_CONCURRENCY = 3

/** Feature→matrices custom filter id for a percentile band. */
export function featurePercentileFilterId(band: ExpressionBand): string {
  return `expression.percentile.${band}`
}

/** Biosample→matrices custom filter id for a detected-genes percentile band. */
export function biosamplePercentileFilterId(band: ExpressionBand): string {
  return `expression.detectedGenesPercentile.${band}`
}

export function isExpressionBand(value: string): value is ExpressionBand {
  return (EXPRESSION_BANDS as readonly string[]).includes(value)
}

export function bandLabel(band: BandCellValue): string {
  if (band === 'absent') return 'Not in matrix'
  if (band === 'none') return 'None'
  return `${band}%`
}

export function bandShortLabel(band: BandCellValue): string {
  if (band === 'absent') return '—'
  if (band === 'none') return '∅'
  if (band === '0-20') return '1'
  if (band === '20-40') return '2'
  if (band === '40-60') return '3'
  if (band === '60-80') return '4'
  return '5'
}

export function bandFill(band: BandCellValue): string {
  if (band === 'absent') return COLOR_MISSING
  if (band === 'none') return COLOR_LOW
  if (band === '0-20') return COLOR_MID_LOW
  if (band === '20-40') return '#a1a1aa'
  if (band === '40-60') return COLOR_MID
  if (band === '60-80') return COLOR_HIGH
  return COLOR_TOP
}

export function bandTextColor(band: BandCellValue): string {
  if (
    band === 'absent' ||
    band === 'none' ||
    band === '0-20' ||
    band === '20-40'
  ) {
    return COLOR_TEXT_DARK
  }
  return COLOR_TEXT_LIGHT
}

/** Legend entries in display order (including absent). */
export const BAND_LEGEND: Array<{ band: BandCellValue; fill: string }> = [
  { band: 'absent', fill: COLOR_MISSING },
  { band: 'none', fill: COLOR_LOW },
  { band: '0-20', fill: COLOR_MID_LOW },
  { band: '20-40', fill: '#a1a1aa' },
  { band: '40-60', fill: COLOR_MID },
  { band: '60-80', fill: COLOR_HIGH },
  { band: '80-100', fill: COLOR_TOP },
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
