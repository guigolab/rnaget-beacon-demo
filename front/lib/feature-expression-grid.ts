import type { ExpressionSummary } from '@/lib/beacon/client'
import { medianForMatrix, primarySummaryForMatrix } from '@/lib/gene-lens'
import { nativeFeatureId } from '@/lib/heatmap-expression'
import type { Feature } from '@/lib/beacon/types'

/** Must match server `MAX_ID_LIST_TOKENS` in server/routers/deps.py */
export const EXPRESSION_SUMMARY_ID_LIST_CHUNK = 200

export type FeatureMatrixCell = {
  featureId: string
  matrixId: string
  median?: number
  summary?: ExpressionSummary
}

export function cellKey(featureId: string, matrixId: string) {
  return `${featureId}\0${matrixId}`
}

export function matrixBatchCacheKey(matrixId: string, featureIDList: string) {
  return `${matrixId}\0${featureIDList}`
}

export function matrixIdsForFeatures(features: Feature[]): string[] {
  const ids = new Set<string>()
  for (const feature of features) {
    for (const mid of feature.matrixIds ?? []) ids.add(mid)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

export function featuresForMatrix(features: Feature[], matrixId: string): Feature[] {
  return features.filter((f) => f.matrixIds?.includes(matrixId))
}

export function chunkCsvTokens(tokens: string[], chunkSize: number): string[] {
  if (!tokens.length) return []
  const chunks: string[] = []
  for (let i = 0; i < tokens.length; i += chunkSize) {
    chunks.push(tokens.slice(i, i + chunkSize).join(','))
  }
  return chunks
}

/** matrixId → CSV featureIDList chunks for POST requestParameters. */
export function chunkFeatureTokens(
  features: Feature[],
  chunkSize = EXPRESSION_SUMMARY_ID_LIST_CHUNK
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const matrixId of matrixIdsForFeatures(features)) {
    const tokens = featuresForMatrix(features, matrixId).map(nativeFeatureId)
    const chunks = chunkCsvTokens(tokens, chunkSize)
    if (chunks.length) out.set(matrixId, chunks)
  }
  return out
}

export type MatrixSummaryBatch = {
  matrixId: string
  featureIDList: string
}

export function matrixSummaryBatches(
  features: Feature[],
  chunkSize = EXPRESSION_SUMMARY_ID_LIST_CHUNK
): MatrixSummaryBatch[] {
  const tasks: MatrixSummaryBatch[] = []
  for (const [matrixId, chunks] of chunkFeatureTokens(features, chunkSize)) {
    for (const featureIDList of chunks) {
      tasks.push({ matrixId, featureIDList })
    }
  }
  return tasks
}

export function featureLookupForSummaries(features: Feature[]): Map<string, Feature> {
  const lookup = new Map<string, Feature>()
  for (const feature of features) {
    lookup.set(feature.id, feature)
    lookup.set(nativeFeatureId(feature), feature)
  }
  return lookup
}

export function applySummaryRows(
  cells: Map<string, FeatureMatrixCell>,
  features: Feature[],
  matrixId: string,
  rows: ExpressionSummary[]
): void {
  const lookup = featureLookupForSummaries(features)
  const byFeatureId = new Map<string, ExpressionSummary[]>()
  for (const row of rows) {
    const token = row.featureId ?? ''
    const feature = lookup.get(token)
    if (!feature) continue
    const bucket = byFeatureId.get(feature.id) ?? []
    bucket.push(row)
    byFeatureId.set(feature.id, bucket)
  }
  for (const [featureId, group] of byFeatureId) {
    cells.set(cellKey(featureId, matrixId), {
      featureId,
      matrixId,
      median: medianForMatrix(group),
      summary: primarySummaryForMatrix(group),
    })
  }
}
