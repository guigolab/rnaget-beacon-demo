export type EntityRecordKind = 'feature' | 'biosample'

export const RECORD_KIND_PARAM = 'recordKind'
export const RECORD_ID_PARAM = 'recordId'

export function parseRecordSheetParams(
  params: URLSearchParams
): { kind: EntityRecordKind; id: string } | null {
  const kind = params.get(RECORD_KIND_PARAM)
  const id = params.get(RECORD_ID_PARAM)?.trim()
  if (!id) return null
  if (kind === 'feature' || kind === 'biosample') {
    return { kind, id }
  }
  return null
}

export function recordSheetSearchParams(
  base: URLSearchParams,
  next: { kind: EntityRecordKind; id: string } | null
): URLSearchParams {
  const params = new URLSearchParams(base.toString())
  if (next) {
    params.set(RECORD_KIND_PARAM, next.kind)
    params.set(RECORD_ID_PARAM, next.id)
  } else {
    params.delete(RECORD_KIND_PARAM)
    params.delete(RECORD_ID_PARAM)
  }
  return params
}

/** Update the address bar without a Next.js navigation (avoids lens page reload). */
export function replaceRecordSheetInBrowserUrl(
  pathname: string,
  next: { kind: EntityRecordKind; id: string } | null
): void {
  if (typeof window === 'undefined') return
  const params = recordSheetSearchParams(
    new URLSearchParams(window.location.search),
    next
  )
  const qs = params.toString()
  const url = qs ? `${pathname}?${qs}` : pathname
  window.history.replaceState(window.history.state, '', url)
}
