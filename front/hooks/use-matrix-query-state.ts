'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
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

export function useMatrixQueryState(matrixId: string) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromNext = searchParams.toString()
  const writtenRef = useRef(fromNext)
  const adoptedRef = useRef(false)
  const [query, setQuery] = useState<MatrixWorkspaceQuery>(() =>
    parseMatrixWorkspaceQuery(new URLSearchParams(fromNext || readLocationQuery()))
  )
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    if (!adoptedRef.current) {
      adoptedRef.current = true
      const initial = fromNext || readLocationQuery()
      writtenRef.current = initial
      if (initial !== fromNext) {
        setQuery(parseMatrixWorkspaceQuery(new URLSearchParams(initial)))
      }
      return
    }
    if (fromNext === writtenRef.current) return
    writtenRef.current = fromNext
    setQuery(parseMatrixWorkspaceQuery(new URLSearchParams(fromNext)))
  }, [fromNext])

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
