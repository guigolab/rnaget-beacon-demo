'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  filterKey,
  isAbortError,
  lookupMatrixBiosamples,
  lookupMatrixFeatures,
} from '@/lib/beacon'
import { nativeFeatureId } from '@/lib/heatmap-expression'
import { chunkIdList, ID_LIST_CHAR_MAX, ID_LIST_TOKEN_MAX } from '@/lib/matrix-cell-window'
import type { MatrixWorkspaceQuery } from '@/lib/matrix-workspace-query'

/**
 * In-matrix ids to collect per constrained axis before ranking. Lower is faster (the
 * root scan stops sooner) but ranks fewer candidates; must stay <= ID_LIST_TOKEN_MAX.
 */
const CANDIDATE_TARGET = 100

export type MatrixCandidates = {
  /** Comma list for `expression_values`; undefined means the axis is unconstrained. */
  featureIDList?: string
  biosampleIDList?: string
  status: 'loading' | 'ready' | 'error'
  error: string
  /** A constrained axis matched nothing in this matrix. */
  noMatch: boolean
}

type Resolved = { featureIDList?: string; biosampleIDList?: string; noMatch: boolean }

/**
 * Typed genes / ids / ontology filters narrow the axes. They resolve here (filters
 * live on collection roots only) to at most one `expression_values` ID-list worth of
 * ids per axis; the ranked `expression_values` slice then orders them by value.
 * With no constraints nothing is resolved and the slice ranks the whole matrix.
 */
export function useMatrixCandidates(
  matrixId: string,
  query: Pick<
    MatrixWorkspaceQuery,
    'featureFilters' | 'genes' | 'featureIds' | 'biosampleFilters' | 'biosampleIds'
  >
): MatrixCandidates {
  const featureTokens = useMemo(
    () => [...new Set([...query.genes, ...query.featureIds])],
    [query.genes, query.featureIds]
  )
  const biosampleTokens = query.biosampleIds
  const featureConstrained = query.featureFilters.length > 0 || featureTokens.length > 0
  const biosampleConstrained =
    query.biosampleFilters.length > 0 || biosampleTokens.length > 0
  const key = useMemo(
    () =>
      JSON.stringify([
        matrixId,
        query.featureFilters.map((f) => filterKey(f)),
        featureTokens,
        query.biosampleFilters.map((f) => filterKey(f)),
        biosampleTokens,
      ]),
    [matrixId, query.featureFilters, query.biosampleFilters, featureTokens, biosampleTokens]
  )
  const [state, setState] = useState<{
    key: string
    resolved: Resolved
    error: string
  } | null>(null)

  useEffect(() => {
    if (!featureConstrained && !biosampleConstrained) return
    const controller = new AbortController()
    const need = CANDIDATE_TARGET
    Promise.all([
      featureConstrained
        ? lookupMatrixFeatures(matrixId, featureTokens, {
            filters: query.featureFilters,
            maxResults: need,
            signal: controller.signal,
          })
        : null,
      biosampleConstrained
        ? lookupMatrixBiosamples(matrixId, biosampleTokens, {
            filters: query.biosampleFilters,
            maxResults: need,
            signal: controller.signal,
          })
        : null,
    ])
      .then(([features, biosamples]) => {
        if (controller.signal.aborted) return
        const firstChunk = (ids: string[]) =>
          chunkIdList(ids, ID_LIST_TOKEN_MAX, ID_LIST_CHAR_MAX)[0] ?? []
        const featureIds = features
          ? firstChunk(features.map((f) => nativeFeatureId(f)).filter(Boolean))
          : undefined
        const biosampleIds = biosamples
          ? firstChunk(biosamples.map((b) => b.id).filter(Boolean))
          : undefined
        setState({
          key,
          error: '',
          resolved: {
            featureIDList: featureIds?.length ? featureIds.join(',') : undefined,
            biosampleIDList: biosampleIds?.length ? biosampleIds.join(',') : undefined,
            noMatch: featureIds?.length === 0 || biosampleIds?.length === 0,
          },
        })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setState({
          key,
          error: err instanceof Error ? err.message : 'Failed to resolve filters',
          resolved: { noMatch: false },
        })
      })
    return () => controller.abort()
    // `key` captures every input below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!featureConstrained && !biosampleConstrained) {
    return { status: 'ready', error: '', noMatch: false }
  }
  if (!state || state.key !== key) {
    return { status: 'loading', error: '', noMatch: false }
  }
  if (state.error) {
    return { status: 'error', error: state.error, noMatch: false }
  }
  return { status: 'ready', error: '', ...state.resolved }
}
