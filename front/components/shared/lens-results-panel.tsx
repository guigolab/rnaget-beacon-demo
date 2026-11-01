'use client'

import type { ReactNode } from 'react'
import { LoadingNote } from '@/components/status'
import { EmptyState } from '@/components/ui-kit'
import { LensResultsHeader } from '@/components/shared/lens-results-header'
import type { LensProbe } from '@/lib/lens-preview-note'

type LensResultsPanelProps = {
  probe: LensProbe
  querySummary: string
  previewLimit: number
  previewCount: number
  previewHint?: string
  previewTruncatedSuffix?: string
  previewWhenShowing?: string
  noMatchesMessage: string
  loadErrorTitle: string
  searchError: string
  searchLoading: boolean
  hasMatches: boolean
  refreshingLabel: string
  canLoadMore: boolean
  pageSize: number
  onLoadMore: () => void
  children: ReactNode
}

export function LensResultsPanel({
  probe,
  querySummary,
  previewLimit,
  previewCount,
  previewHint,
  previewTruncatedSuffix,
  previewWhenShowing,
  noMatchesMessage,
  loadErrorTitle,
  searchError,
  searchLoading,
  hasMatches,
  refreshingLabel,
  canLoadMore,
  pageSize,
  onLoadMore,
  children,
}: LensResultsPanelProps) {
  return (
    <div className="space-y-4">
      <LensResultsHeader
        querySummary={querySummary}
        probe={probe}
        previewLimit={previewLimit}
        previewCount={previewCount}
        previewHint={previewHint}
        previewTruncatedSuffix={previewTruncatedSuffix}
        previewWhenShowing={previewWhenShowing}
      />

      {probe.exists === false && !probe.loading && (
        <p className="text-sm text-muted-foreground">{noMatchesMessage}</p>
      )}

      {probe.exists === true && searchLoading && !hasMatches && (
        <div className="py-6">
          <LoadingNote />
        </div>
      )}

      {probe.exists === true && searchError && !hasMatches && (
        <EmptyState title={loadErrorTitle} description={searchError} />
      )}

      {probe.exists === true && hasMatches && (
        <>
          {searchLoading && (
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              {refreshingLabel}
            </p>
          )}
          {!searchLoading && searchError && (
            <p className="text-xs text-destructive">{searchError}</p>
          )}
          {children}
          {canLoadMore && (
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              onClick={onLoadMore}
            >
              Load {pageSize} more
            </button>
          )}
        </>
      )}
    </div>
  )
}
