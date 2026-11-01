'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilterScopeIndex } from '@/lib/beacon/filters'
import {
  emptyMatrixWorkspaceQuery,
  matrixWorkspaceQueryKey,
  matrixWorkspaceSearchParams,
  parseMatrixWorkspaceQuery,
  type MatrixWorkspaceQuery,
} from '@/lib/matrix-workspace-query'

function readLocationQuery(): string {
  if (typeof window === 'undefined') return ''
  return window.location.search.replace(/^\?/, '')
}

/**
 * Matrix detail query. Next's search params are the source of truth after hydration.
 * A deep link can be visible in `location.search` before those params hydrate, so the
 * first client effect adopts it once. Later empty URLs stay empty.
 */
export type MatrixQueryUpdate =
  | Partial<MatrixWorkspaceQuery>
  | ((current: MatrixWorkspaceQuery) => Partial<MatrixWorkspaceQuery>)

function scopeIndexKey(index: FilterScopeIndex | undefined): string {
  if (!index || index.size === 0) return ''
  const parts: string[] = []
  for (const [key, scope] of index) parts.push(`${key}=${scope}`)
  parts.sort()
  return parts.join('|')
}

export function useMatrixQueryState(matrixId: string, scopeIndex?: FilterScopeIndex) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const indexRef = useRef(scopeIndex)
  indexRef.current = scopeIndex
  const indexKey = useMemo(() => scopeIndexKey(scopeIndex), [scopeIndex])
  const fromNext = searchParams.toString()
  const writtenRef = useRef(fromNext)
  const adoptedRef = useRef(false)
  const [query, setQuery] = useState<MatrixWorkspaceQuery>(() =>
    parseMatrixWorkspaceQuery(
      new URLSearchParams(fromNext || readLocationQuery()),
      scopeIndex
    )
  )
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    if (!adoptedRef.current) {
      adoptedRef.current = true
      const initial = fromNext || readLocationQuery()
      writtenRef.current = initial
      if (initial !== fromNext) {
        setQuery(parseMatrixWorkspaceQuery(new URLSearchParams(initial), indexRef.current))
      }
      return
    }
    if (fromNext === writtenRef.current) return
    writtenRef.current = fromNext
    setQuery(parseMatrixWorkspaceQuery(new URLSearchParams(fromNext), indexRef.current))
  }, [fromNext])

  useEffect(() => {
    if (!adoptedRef.current) return
    setQuery(
      parseMatrixWorkspaceQuery(new URLSearchParams(writtenRef.current), indexRef.current)
    )
  }, [indexKey])

  const queryKey = matrixWorkspaceQueryKey(query)

  const replace = useCallback(
    (next: MatrixWorkspaceQuery) => {
      if (matrixWorkspaceQueryKey(next) === matrixWorkspaceQueryKey(queryRef.current)) return
      const params = matrixWorkspaceSearchParams(
        next,
        new URLSearchParams(readLocationQuery())
      )
      const qs = params.toString()
      writtenRef.current = qs
      queryRef.current = next
      setQuery(next)
      const path = `/matrices/${encodeURIComponent(matrixId)}/`
      router.replace(qs ? `${path}?${qs}` : path, { scroll: false })
    },
    [matrixId, router]
  )

  const patch = useCallback(
    (update: MatrixQueryUpdate) => {
      const current = queryRef.current
      const partial = typeof update === 'function' ? update(current) : update
      replace({ ...current, ...partial })
    },
    [replace]
  )

  const clearFilters = useCallback(() => {
    replace({
      ...emptyMatrixWorkspaceQuery(),
      sort: query.sort,
      order: query.order,
    })
  }, [query.order, query.sort, replace])

  return { query, queryKey, patch, replace, clearFilters }
}
