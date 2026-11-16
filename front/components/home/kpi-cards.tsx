'use client'

import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import type { HomeCounts } from '@/hooks/use-home-counts'
import { entryTypeScope, scopeCssVars } from '@/lib/scope-theme'

type Kpi = {
  key: keyof Pick<HomeCounts, 'features' | 'biosamples' | 'matrices'>
  label: string
  entryId: string
}

const KPIS: Kpi[] = [
  { key: 'features', label: 'Genomic features', entryId: 'feature' },
  { key: 'biosamples', label: 'Biosamples', entryId: 'biosample' },
  { key: 'matrices', label: 'Matrices', entryId: 'matrix' },
]

type KpiCardsProps = {
  counts: HomeCounts
}

/** One compact stat strip: count-granularity probes on the three root collections. */
export function KpiCards({ counts }: KpiCardsProps) {
  return (
    <section className="space-y-2" aria-label="Catalog totals">
      {counts.error && (
        <p className="text-sm text-destructive">{counts.error}</p>
      )}
      <dl className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {KPIS.map((kpi) => {
          const colors = scopeCssVars(entryTypeScope(kpi.entryId))
          const value = counts[kpi.key]
          return (
            <div key={kpi.key} className="min-w-0 px-4 py-3">
              <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colors.border }}
                  aria-hidden
                />
                <span className="truncate">{kpi.label}</span>
              </dt>
              <dd className="mt-1">
                {counts.loading && value == null ? (
                  <span className="block h-7 w-20 animate-pulse rounded bg-muted" />
                ) : (
                  <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                    {value != null ? value.toLocaleString() : 'n/a'}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <LensMutedEndpoints
        lines={['GET /info', 'GET /features', 'GET /biosamples', 'GET /matrices']}
      />
    </section>
  )
}
