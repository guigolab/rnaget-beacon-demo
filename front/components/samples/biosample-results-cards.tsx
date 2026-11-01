'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { EntityRecordLink } from '@/components/shared/entity-record-link'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import type { Biosample } from '@/lib/beacon/types'
import {
  biosampleDisplayLabel,
  biosampleMatrixHeatmapHref,
  biosampleResultChipTerms,
  preferredMatrixIdForBiosample,
} from '@/lib/sample-lens'

type BiosampleResultsCardsProps = {
  samples: Biosample[]
  focusMatrix: string | null
}

function BiosampleResultCard({
  sample,
  focusMatrix,
}: {
  sample: Biosample
  focusMatrix: string | null
}) {
  const openMatrixId = preferredMatrixIdForBiosample(sample, focusMatrix)
  const heatmapHref =
    openMatrixId != null
      ? biosampleMatrixHeatmapHref(sample.id, openMatrixId)
      : null
  const chips = biosampleResultChipTerms(sample)

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-border/80 hover:bg-muted/20 sm:flex-row sm:items-stretch">
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="min-w-0">
          <EntityRecordLink
            kind="biosample"
            id={sample.id}
            title="Open biosample details"
            className="text-left text-base font-semibold leading-snug text-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            {biosampleDisplayLabel(sample)}
          </EntityRecordLink>
          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
            <EntityRecordLink
              kind="biosample"
              id={sample.id}
              title="Open biosample record"
              className="underline-offset-2 hover:text-primary hover:underline"
            >
              {sample.id}
            </EntityRecordLink>
          </p>
        </div>

        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <MetaBadge
                key={chip.key}
                variant={chip.accent ? 'accent' : 'muted'}
                title={chip.title}
              >
                {chip.label}
              </MetaBadge>
            ))}
          </div>
        )}

        {sample.description?.trim() ? (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {sample.description.trim()}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-center border-t border-border/80 px-4 py-3 sm:max-w-[14rem] sm:border-l sm:border-t-0">
        {heatmapHref && openMatrixId ? (
          <Link
            href={heatmapHref}
            className="inline-flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-muted sm:w-auto"
            title={`Open matrix ${openMatrixId} with this biosample in the heatmap`}
          >
            <span className="min-w-0 break-all text-center font-mono text-[10px] leading-snug">
              {openMatrixId}
            </span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </Link>
        ) : (
          <span
            className="inline-flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground sm:w-auto"
            title="No related matrix id on this record"
          >
            <span className="font-mono text-[10px]">—</span>
            <ExternalLink className="size-3.5 shrink-0 opacity-40" aria-hidden />
          </span>
        )}
      </div>
    </article>
  )
}

export function BiosampleResultsCards({
  samples,
  focusMatrix,
}: BiosampleResultsCardsProps) {
  return (
    <div className="flex flex-col gap-3">
      {samples.map((sample) => (
        <BiosampleResultCard
          key={sample.id}
          sample={sample}
          focusMatrix={focusMatrix}
        />
      ))}
    </div>
  )
}
