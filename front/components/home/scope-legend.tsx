import { BEACON_SCOPES, SCOPE_LEGEND, scopeCssVars } from '@/lib/scope-theme'

type ScopeLegendProps = {
  className?: string
  compact?: boolean
}

export function ScopeLegend({ className = '', compact = false }: ScopeLegendProps) {
  const items = SCOPE_LEGEND.filter((item) => BEACON_SCOPES.includes(item.scope))

  return (
    <div
      className={`flex flex-wrap gap-3 ${compact ? 'gap-2 text-xs' : 'text-sm'} ${className}`}
      role="list"
      aria-label="Filter scope legend"
    >
      {items.map(({ scope, label, hint }) => {
        const v = scopeCssVars(scope)
        return (
          <div
            key={scope}
            role="listitem"
            className="flex min-w-[10rem] items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-sm"
          >
            <span
              className="h-8 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: v.border }}
              aria-hidden
            />
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[10px] font-semibold uppercase"
              style={{
                backgroundColor: v.bg,
                borderColor: v.border,
                color: v.text,
              }}
              aria-hidden
            >
              {scope === 'genomicFeature' ? 'GF' : scope.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="font-medium leading-tight text-foreground">{label}</p>
              {!compact && (
                <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
