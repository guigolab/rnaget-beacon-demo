import {
  COLOR_HIGH,
  COLOR_LOW,
  COLOR_MID,
  COLOR_MID_LOW,
  COLOR_TEXT_DARK,
  COLOR_TEXT_LIGHT,
  COLOR_TOP,
} from '@/components/heatmap-colors'
import type { Biosample, ExpressionValue, Feature } from '@/lib/beacon/types'

export function nativeFeatureId(feature: Feature) {
  return feature.featureIdentifier?.id ?? feature.id
}

export function featureTokens(feature: Feature): string[] {
  const tokens: string[] = []
  const push = (value?: string) => {
    if (value && !tokens.includes(value)) tokens.push(value)
  }
  push(feature.featureIdentifier?.id)
  for (const alias of feature.aliases ?? []) push(alias)
  push(feature.id)
  return tokens
}

export function cellKey(featureId: string, biosampleId: string) {
  return `${featureId}:${biosampleId}`
}

/**
 * Put ``leadingIds`` first (stubs OK), then ``items`` in arrival order.
 * Does not append extras at the end — only reorders / inserts leaders.
 */
export function preferLeadingBiosamples(
  items: readonly Biosample[],
  leadingIds: readonly string[]
): Biosample[] {
  if (!leadingIds.length) return items.length ? [...items] : []
  const byId = new Map<string, Biosample>()
  for (const sample of items) {
    const id = sample.id?.trim()
    if (!id || byId.has(id)) continue
    byId.set(id, sample)
  }
  const leading: Biosample[] = []
  const seen = new Set<string>()
  for (const raw of leadingIds) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    leading.push(byId.get(id) ?? { id })
  }
  const rest: Biosample[] = []
  for (const sample of items) {
    const id = sample.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    rest.push(sample)
  }
  return leading.length ? [...leading, ...rest] : rest
}

export function mergeFeatureExpressionCells(
  next: Map<string, number>,
  feature: Feature,
  cells: Map<string, number> | undefined
) {
  if (!cells) return
  const rowId = nativeFeatureId(feature)
  for (const [biosampleId, value] of cells) {
    const key = cellKey(rowId, biosampleId)
    const prev = next.get(key)
    if (prev == null || value > prev) next.set(key, value)
  }
}

export function indexExpression(features: Feature[], rows: ExpressionValue[]): {
  values: Map<string, number>
  unmatched: Feature[]
} {
  const byFeature = new Map<string, Map<string, number>>()
  for (const row of rows) {
    let cells = byFeature.get(row.featureId)
    if (!cells) {
      cells = new Map()
      byFeature.set(row.featureId, cells)
    }
    cells.set(row.biosampleId, row.value)
  }
  const values = new Map<string, number>()
  const claimed = new Set<string>()
  const unmatched: Feature[] = []
  for (const feature of features) {
    const tokens = new Set(featureTokens(feature))
    let matched = false
    for (const featureId of byFeature.keys()) {
      if (!tokens.has(featureId)) continue
      matched = true
      claimed.add(featureId)
      mergeFeatureExpressionCells(values, feature, byFeature.get(featureId))
    }
    if (!matched) unmatched.push(feature)
  }
  const leftover = [...byFeature.keys()].filter((id) => !claimed.has(id))
  if (unmatched.length === 1) {
    for (const id of leftover)
      mergeFeatureExpressionCells(values, unmatched[0], byFeature.get(id))
    return { values, unmatched: [] }
  }
  return { values, unmatched }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function mix(a: string, b: string, t: number) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r},${g},${bl})`
}

export function heatFill(value: number, min: number, max: number) {
  const ratio = max === min ? 0.5 : (value - min) / (max - min)
  const t = Math.max(0, Math.min(1, ratio))
  if (t < 0.33) return mix(COLOR_LOW, COLOR_MID_LOW, t / 0.33)
  if (t < 0.66) return mix(COLOR_MID_LOW, COLOR_MID, (t - 0.33) / 0.33)
  if (t < 0.85) return mix(COLOR_MID, COLOR_HIGH, (t - 0.66) / 0.19)
  return mix(COLOR_HIGH, COLOR_TOP, (t - 0.85) / 0.15)
}

export function heatTextColor(value: number, min: number, max: number) {
  const ratio = max === min ? 0.5 : (value - min) / (max - min)
  return ratio >= 0.45 ? COLOR_TEXT_LIGHT : COLOR_TEXT_DARK
}

export function formatHeatmapValue(value: number) {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 100) return value.toFixed(0)
  if (Math.abs(value) >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

/** Bounds for heatFill / legend bar — matrix catalog when present. */
export function matrixHeatmapColorScaleBounds(
  catalog: { min?: number; max?: number } | null | undefined,
  visibleMin: number,
  visibleMax: number
): { min: number; max: number } {
  if (
    catalog?.min != null &&
    catalog?.max != null &&
    Number.isFinite(catalog.min) &&
    Number.isFinite(catalog.max)
  ) {
    const min = catalog.min
    const max = catalog.max >= min ? catalog.max : min + 1
    return { min, max }
  }
  if (!Number.isFinite(visibleMin) || !Number.isFinite(visibleMax)) {
    return { min: 0, max: 1 }
  }
  if (visibleMin === 0 && visibleMax === 0) {
    return { min: 0, max: 1 }
  }
  const min = visibleMin
  const max = visibleMax > min ? visibleMax : min + 1
  return { min, max }
}

export type MatrixColourMode = 'value' | 'percentileInFeature' | 'percentileInBiosample'

/**
 * Demo approximation: percentile ranks within the currently loaded heatmap window
 * (not matrix-wide). Ties share the average rank. Scale is 0–100.
 */
export function windowPercentileColourValues(
  values: Map<string, number>,
  features: readonly Feature[],
  biosamples: readonly Biosample[],
  mode: 'percentileInFeature' | 'percentileInBiosample'
): Map<string, number> {
  const out = new Map<string, number>()
  if (mode === 'percentileInFeature') {
    for (const feature of features) {
      const featureId = nativeFeatureId(feature)
      const cells: Array<{ key: string; value: number }> = []
      for (const sample of biosamples) {
        const key = cellKey(featureId, sample.id)
        const value = values.get(key)
        if (value == null || !Number.isFinite(value)) continue
        cells.push({ key, value })
      }
      assignAverageRankPercentiles(cells, out)
    }
    return out
  }
  for (const sample of biosamples) {
    const cells: Array<{ key: string; value: number }> = []
    for (const feature of features) {
      const key = cellKey(nativeFeatureId(feature), sample.id)
      const value = values.get(key)
      if (value == null || !Number.isFinite(value)) continue
      cells.push({ key, value })
    }
    assignAverageRankPercentiles(cells, out)
  }
  return out
}

function assignAverageRankPercentiles(
  cells: Array<{ key: string; value: number }>,
  out: Map<string, number>
) {
  if (!cells.length) return
  if (cells.length === 1) {
    out.set(cells[0].key, 50)
    return
  }
  const sorted = [...cells].sort((a, b) => a.value - b.value || a.key.localeCompare(b.key))
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && sorted[j].value === sorted[i].value) j += 1
    const avgRank = (i + (j - 1)) / 2
    const pct = (avgRank / (sorted.length - 1)) * 100
    for (let k = i; k < j; k++) out.set(sorted[k].key, pct)
    i = j
  }
}
