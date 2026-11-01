'use client'

import { buildLensPreviewNote, type LensProbe } from '@/lib/lens-preview-note'

export type { LensProbe }

type LensResultsHeaderProps = {
  querySummary: string
  probe: LensProbe
  /** Current fetch cap (display limit); used for legacy truncation when no suffix is set */
  previewLimit: number
  /** Rows currently rendered in the preview */
  previewCount: number
  /** Shorthand for both previewWhenShowing and previewTruncatedSuffix (samples / matrices) */
  previewHint?: string
  /** Appended after "Showing X of Y · " when truncated */
  previewTruncatedSuffix?: string
  /** Shown when there are preview rows but list is not truncated */
  previewWhenShowing?: string
}

export function LensResultsHeader({
  querySummary,
  probe,
  previewLimit,
  previewCount,
  previewHint,
  previewTruncatedSuffix,
  previewWhenShowing,
}: LensResultsHeaderProps) {
  let countLine: string
  if (probe.loading) {
    countLine = 'Checking…'
  } else if (probe.error) {
    countLine = '—'
  } else if (probe.exists === false) {
    countLine = '0 matches'
  } else if (probe.total != null) {
    countLine = `${probe.total.toLocaleString()} match${probe.total === 1 ? '' : 'es'}`
  } else {
    countLine = '—'
  }

  const previewNote = buildLensPreviewNote({
    probe,
    previewLimit,
    previewCount,
    previewHint,
    previewTruncatedSuffix,
    previewWhenShowing,
  })

  return (
    <header className="border-b border-border pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Results</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{querySummary}</p>
        </div>
        <p
          className={`shrink-0 text-sm font-medium tabular-nums ${
            probe.exists === false && !probe.loading
              ? 'text-red-600/90'
              : probe.exists === true && !probe.loading
                ? 'text-emerald-700'
                : 'text-muted-foreground'
          }`}
        >
          {countLine}
        </p>
      </div>
      {previewNote && (
        <p className="mt-1.5 text-xs text-muted-foreground">{previewNote}</p>
      )}
    </header>
  )
}
