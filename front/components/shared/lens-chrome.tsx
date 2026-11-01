'use client'

import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui-kit'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'

type LensChromeProps = {
  sidebar: ReactNode
  queryBar: ReactNode
  endpointLines: string[]
  hasFilters: boolean
  emptyState: { title: string; description: string }
  resultsPanel: ReactNode
  detail?: ReactNode
}

export function LensChrome({
  sidebar,
  queryBar,
  endpointLines,
  hasFilters,
  emptyState,
  resultsPanel,
  detail,
}: LensChromeProps) {
  return (
    <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
      {sidebar}

      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/20 px-4 py-3">
          {queryBar}
          <div className="mt-2">
            <LensMutedEndpoints lines={endpointLines} />
          </div>
        </div>

        <div className="px-4 py-4">
          {!hasFilters && (
            <EmptyState
              title={emptyState.title}
              description={emptyState.description}
            />
          )}

          {hasFilters && resultsPanel}

          {detail && (
            <div className="mt-8 border-t border-border pt-6">{detail}</div>
          )}
        </div>
      </div>
    </div>
  )
}
