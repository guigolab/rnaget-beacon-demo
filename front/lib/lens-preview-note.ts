export type LensProbe = {
  loading: boolean
  exists?: boolean
  total?: number
  error: string
}

export function buildLensPreviewNote(args: {
  probe: LensProbe
  previewLimit: number
  previewCount: number
  previewHint?: string
  previewTruncatedSuffix?: string
  previewWhenShowing?: string
}): string | null {
  const {
    probe,
    previewLimit,
    previewCount,
    previewHint,
    previewTruncatedSuffix,
    previewWhenShowing,
  } = args

  const whenShowing = previewWhenShowing ?? previewHint
  const truncatedSuffix = previewTruncatedSuffix ?? previewHint

  const isTruncated =
    probe.exists === true &&
    probe.total != null &&
    (truncatedSuffix ? probe.total > previewCount : probe.total > previewLimit)

  if (isTruncated) {
    if (truncatedSuffix && probe.total != null) {
      return `Showing ${previewCount} of ${probe.total.toLocaleString()} · ${truncatedSuffix}`
    }
    return `Showing first ${previewCount} at record granularity (limit ${previewLimit})`
  }

  if (probe.exists === true && previewCount > 0 && whenShowing) {
    return whenShowing
  }

  if (probe.exists === true && previewCount > 0 && !truncatedSuffix && !whenShowing) {
    return 'Record granularity'
  }

  return null
}
