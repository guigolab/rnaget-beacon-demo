'use client'

export type MatrixHeatmapViewMode = 'heatmap' | 'summary'

type MatrixHeatmapViewToggleProps = {
  value: MatrixHeatmapViewMode
  onChange: (mode: MatrixHeatmapViewMode) => void
  className?: string
  /** id of the tabpanel this toggle controls */
  controls?: string
}

export function MatrixHeatmapViewToggle({
  value,
  onChange,
  className = '',
  controls,
}: MatrixHeatmapViewToggleProps) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1 rounded-md border border-border bg-background p-0.5 ${className}`}
      role="tablist"
      aria-label="Matrix feature view"
    >
      {(
        [
          ['heatmap', 'Heatmap'],
          ['summary', 'Summary'],
        ] as const
      ).map(([mode, label]) => {
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            id={`matrix-view-tab-${mode}`}
            role="tab"
            aria-selected={active}
            aria-controls={controls}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-muted text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => onChange(mode)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
