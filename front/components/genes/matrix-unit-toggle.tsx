'use client'

import { useMemo } from 'react'
import type { CompareBucket } from '@/lib/comparability'

type MatrixUnitToggleProps = {
  buckets: CompareBucket[]
  activeKey: string | null
  onChange: (key: string) => void
  className?: string
}

function sortBuckets(buckets: CompareBucket[]): CompareBucket[] {
  return [...buckets].sort(
    (a, b) =>
      b.matrices.length - a.matrices.length || a.label.localeCompare(b.label)
  )
}

export function MatrixUnitToggle({
  buckets,
  activeKey,
  onChange,
  className = '',
}: MatrixUnitToggleProps) {
  const sorted = useMemo(() => sortBuckets(buckets), [buckets])

  if (sorted.length === 0) return null

  if (sorted.length === 1) {
    const only = sorted[0]
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${className}`}
      >
        <p className="text-xs font-medium text-foreground">Unit view</p>
        <p className="text-xs text-muted-foreground text-right">
          {only.label}
          <span className="text-muted-foreground/80">
            {' '}
            · {only.matrices.length} matri{only.matrices.length === 1 ? 'x' : 'ces'}
          </span>
        </p>
      </div>
    )
  }

  const active = sorted.find((b) => b.key === activeKey)

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-xs font-medium text-foreground shrink-0">Unit view</p>
        <div
          className="flex flex-wrap items-center justify-end gap-2"
          role="tablist"
          aria-label="Expression unit and scale"
        >
          {sorted.map((bucket) => {
            const isActive = bucket.key === activeKey
            return (
              <button
                key={bucket.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'border-primary bg-muted font-medium text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
                onClick={() => onChange(bucket.key)}
              >
                {bucket.label}
                <span className="ml-1 tabular-nums text-muted-foreground">
                  ({bucket.matrices.length})
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {active && (
        <p className="text-xs text-muted-foreground">
          {active.comparability.detail ??
            'Matrices in this view share the same unit and scale.'}
        </p>
      )}
    </div>
  )
}
