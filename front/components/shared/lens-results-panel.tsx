'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
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
  loadingMore?: boolean
  pageSize: number
  onLoadMore: () => void
  onClearFilters?: () => void
  children: ReactNode
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
      <div className="h-16 animate-pulse rounded-xl bg-muted" />
    </div>
  )
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
  loadingMore = false,
  pageSize,
  onLoadMore,
  onClearFilters,
  children,
}: LensResultsPanelProps) {
  const remaining =
    probe.total != null ? Math.max(probe.total - previewCount, 0) : null

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

      {searchLoading && !hasMatches && <ResultsSkeleton />}

      {!searchLoading && probe.exists === false && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{noMatchesMessage}</p>
          {onClearFilters && (
            <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {!searchLoading && searchError && !hasMatches && probe.exists !== false && (
        <EmptyState title={loadErrorTitle} description={searchError} />
      )}

      {hasMatches && (
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              Load {pageSize} more
              {remaining != null && (
                <span className="font-normal text-muted-foreground">
                  · {remaining.toLocaleString()} left
                </span>
              )}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
