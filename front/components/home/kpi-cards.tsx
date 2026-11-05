'use client'

import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import type { HomeCounts } from '@/hooks/use-home-counts'
import { entryTypeScope, scopeCssVars } from '@/lib/scope-theme'

type Kpi = {
  key: keyof Pick<HomeCounts, 'features' | 'biosamples' | 'matrices'>
  label: string
  entryId: string
  endpoint: string
}

const KPIS: Kpi[] = [
  {
    key: 'features',
    label: 'Genomic features',
    entryId: 'feature',
    endpoint: 'GET /features',
  },
  {
    key: 'biosamples',
    label: 'Biosamples',
    entryId: 'biosample',
    endpoint: 'GET /biosamples',
  },
  {
    key: 'matrices',
    label: 'Matrices',
    entryId: 'matrix',
    endpoint: 'GET /matrices',
  },
]

type KpiCardsProps = {
  counts: HomeCounts
}

export function KpiCards({ counts }: KpiCardsProps) {
  return (
    <section className="space-y-3" aria-label="Catalog totals">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Catalog totals
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Count-granularity probes against the live Beacon collections.
        </p>
      </div>
      {counts.error && (
        <p className="text-sm text-destructive">{counts.error}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {KPIS.map((kpi) => {
          const scope = entryTypeScope(kpi.entryId)
          const colors = scopeCssVars(scope)
          const value = counts[kpi.key]
          return (
            <article
              key={kpi.key}
              className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
            >
              <div
                className="absolute inset-y-0 left-0 w-1"
                style={{ backgroundColor: colors.border }}
                aria-hidden
              />
              <div className="px-4 py-3 pl-5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {kpi.label}
                </p>
                {counts.loading && value == null ? (
                  <div className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                    {value != null ? value.toLocaleString() : 'n/a'}
                  </p>
                )}
                <div className="mt-2">
                  <LensMutedEndpoints lines={[kpi.endpoint]} />
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
