import type { Matrix } from '@/lib/beacon/types'

export type ComparabilityLevel = 'direct' | 'bridged' | 'incompatible'

export type ComparabilityResult = {
  level: ComparabilityLevel
  label: string
  detail: string
}

export type MatrixSignature = {
  unit: string
  scale: string
  source: string
  version: string
  assembly: string
}

export function matrixSignature(m: Matrix): MatrixSignature {
  const uas = m.expressionUnitAndScale ?? {}
  const ann = m.annotation ?? {}
  return {
    unit: String(uas.unit ?? ''),
    scale: String(uas.scale ?? 'linear'),
    source: String(ann.source ?? ''),
    version: String(ann.version ?? ''),
    assembly: String(m.assembly?.name ?? m.assembly?.accession ?? ''),
  }
}

export function matrixUnitLabel(m: Matrix): string {
  const s = matrixSignature(m)
  const unit = s.unit || 'unknown unit'
  const scale = s.scale && s.scale !== 'linear' ? ` · ${s.scale}` : ''
  return `${unit}${scale}`
}

export function unitScaleKey(m: Matrix): string {
  const s = matrixSignature(m)
  return `${s.unit}|${s.scale}`
}

export type CompareBucket = {
  key: string
  label: string
  matrices: Matrix[]
  comparability: ComparabilityResult
}

export function groupMatricesForCompare(matrices: Matrix[]): CompareBucket[] {
  const map = new Map<string, Matrix[]>()
  for (const m of matrices) {
    const key = unitScaleKey(m)
    const list = map.get(key) ?? []
    list.push(m)
    map.set(key, list)
  }
  return [...map.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket[0] ? matrixUnitLabel(bucket[0]) : key,
      matrices: bucket,
      comparability: compareMatrixSet(bucket),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function compareMatrices(a: Matrix, b: Matrix): ComparabilityResult {
  const sa = matrixSignature(a)
  const sb = matrixSignature(b)
  if (
    sa.unit === sb.unit &&
    sa.scale === sb.scale &&
    sa.source === sb.source &&
    sa.version === sb.version &&
    sa.assembly === sb.assembly
  ) {
    return {
      level: 'direct',
      label: 'Directly comparable',
      detail: 'Same unit, scale, annotation, and assembly.',
    }
  }
  if (sa.unit === sb.unit && sa.scale === sb.scale) {
    return {
      level: 'bridged',
      label: 'Bridged comparison',
      detail: `Different annotation (${sa.source} ${sa.version} vs ${sb.source} ${sb.version}). Join by gene symbol or xref.`,
    }
  }
  return {
    level: 'incompatible',
    label: 'Not comparable on one axis',
    detail: `Units/scales differ (${sa.unit}/${sa.scale} vs ${sb.unit}/${sb.scale}). Show side-by-side only.`,
  }
}

export function compareMatrixSet(matrices: Matrix[]): ComparabilityResult {
  if (matrices.length < 2) {
    return {
      level: 'direct',
      label: 'Single matrix',
      detail: 'Select another matrix to compare.',
    }
  }
  let worst: ComparabilityResult = compareMatrices(matrices[0], matrices[1])
  for (let i = 2; i < matrices.length; i += 1) {
    const next = compareMatrices(matrices[0], matrices[i])
    if (next.level === 'incompatible') worst = next
    else if (next.level === 'bridged' && worst.level === 'direct') worst = next
  }
  return worst
}
