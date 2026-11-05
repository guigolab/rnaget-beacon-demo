'use client'

import { useMemo, useState } from 'react'

export type PagedList<T> = {
  page: number
  pageSize: number
  total: number
  pageCount: number
  start: number
  end: number
  items: T[]
  canPrev: boolean
  canNext: boolean
  setPage: (page: number) => void
  prev: () => void
  next: () => void
  reset: () => void
}

export function usePagedList<T>(
  items: readonly T[],
  pageSize: number
): PagedList<T> {
  const size = Math.max(1, pageSize)
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / size) || 1)
  const [page, setPageRaw] = useState(0)

  const pageClamped = Math.min(page, pageCount - 1)
  const start = pageClamped * size
  const end = Math.min(start + size, total)
  const slice = useMemo(
    () => items.slice(start, end),
    [items, start, end]
  )

  function setPage(next: number) {
    setPageRaw(Math.max(0, Math.min(pageCount - 1, next)))
  }

  return {
    page: pageClamped,
    pageSize: size,
    total,
    pageCount,
    start,
    end,
    items: slice,
    canPrev: pageClamped > 0,
    canNext: pageClamped < pageCount - 1,
    setPage,
    prev: () => setPage(pageClamped - 1),
    next: () => setPage(pageClamped + 1),
    reset: () => setPageRaw(0),
  }
}
