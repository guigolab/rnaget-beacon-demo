import Link from 'next/link'
import { BandHeatmapLegend } from '@/components/shared/band-heatmap-legend'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STEPS: Array<{ title: string; body: string; endpoints?: string[] }> = [
  {
    title: 'Pick genes and/or tissues',
    body: 'Gene filters hit /features (genomicFeature). Tissue filters (UBERON/EFO) are biosample ontology terms in the URL.',
    endpoints: ['GET or POST /features', 'GET /filtering_terms'],
  },
  {
    title: 'Seed the gene list',
    body: 'A single tissue with no gene filters runs tissueTop:{oid} first (every row is ≥99 for that column), then continues with tissuePresent:{oid}. Pages of 30 genes, with Load more.',
    endpoints: ['GET or POST /features'],
  },
  {
    title: 'Resolve tissue columns',
    body: 'Columns come from biosample-scope ontology terms in /filtering_terms. Non-tissue sample constraints probe POST /matrices/{id}/biosamples at count granularity and keep columns with n > 0.',
    endpoints: [
      'GET /filtering_terms',
      'POST /matrices/{id}/biosamples',
    ],
  },
  {
    title: 'Local presence',
    body: 'A gene is present in a tissue when Feature.matrixIds intersects the matrices that list that tissue (ontology→matrix index from per-matrix filtering_terms). No extra presence request.',
  },
  {
    title: 'Band each visible cell',
    body: '≥99 = within-tissue top 1% (tissueTop probe). <99 = present but not top. Hatched = not in any matrix for that tissue. Only on-screen columns are probed.',
    endpoints: ['GET or POST /features'],
  },
  {
    title: 'Click through the models',
    body: 'Row, column, and cell popovers open Features, Biosamples, and Matrices detail — the heatmap is a navigation surface across all four Beacon models, including nested expression values on a matrix.',
  },
]

export function ExploreHowItWorks() {
  return (
    <section id="explore" className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          How Explore uses the models
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          The Explore heatmap joins genomic features, biosamples, matrices, and
          nested expression values into one gene × tissue view — a concrete use
          case for the Beacon models in this demo.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/20 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Flow
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            {[
              'Filters',
              'Gene list',
              'Columns',
              'Presence',
              'Bands',
              'Navigate',
            ].map((label, index, all) => (
              <span key={label} className="inline-flex items-center gap-2">
                <span className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground">
                  {label}
                </span>
                {index < all.length - 1 && (
                  <span className="text-muted-foreground" aria-hidden>
                    →
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        <ol className="divide-y divide-border">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 px-4 py-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold tabular-nums text-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
                {step.endpoints && (
                  <LensMutedEndpoints lines={step.endpoints} />
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3">
          <BandHeatmapLegend variant="tissue" />
          <Link
            href="/explore/?filters=UBERON:0002107"
            className={cn(buttonVariants({ size: 'sm' }))}
          >
            Try liver Explore
          </Link>
        </div>
      </div>
    </section>
  )
}
