'use client'

import type { CompareBucket } from '@/lib/comparability'

type MatrixUnitToggleProps = {
  buckets: CompareBucket[]
  activeKey: string | null
  onChange: (key: string) => void
  className?: string
}

export function MatrixUnitToggle({
  buckets,
  activeKey,
  onChange,
  className = '',
}: MatrixUnitToggleProps) {
  if (buckets.length === 0) return null

  if (buckets.length === 1) {
    const only = buckets[0]
    return (
      <p className={`text-xs text-muted-foreground ${className}`}>
        <span className="font-medium text-foreground">Unit view </span>
        {only.label}
        <span className="text-muted-foreground/80">
          {' '}
          · {only.matrices.length} matri{only.matrices.length === 1 ? 'x' : 'ces'}
        </span>
      </p>
    )
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <p className="text-xs font-medium text-foreground">Unit view</p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Expression unit and scale">
        {buckets.map((bucket) => {
          const active = bucket.key === activeKey
          return (
            <button
              key={bucket.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                active
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
      {activeKey && (
        <p className="text-xs text-muted-foreground">
          {buckets.find((b) => b.key === activeKey)?.comparability.detail ??
            'Matrices in this view share the same unit and scale.'}
        </p>
      )}
    </div>
  )
}
