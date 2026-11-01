'use client'

import Link from 'next/link'
import { EntityRecordLink } from '@/components/shared/entity-record-link'
import type { Biosample } from '@/lib/beacon/types'
import {
  biosampleDisplayLabel,
  matrixCountForBiosample,
} from '@/lib/sample-lens'

type BiosampleResultsTableProps = {
  samples: Biosample[]
  selectedSampleId: string | null
  buildSampleHref: (sampleId: string) => string
}

export function BiosampleResultsTable({
  samples,
  selectedSampleId,
  buildSampleHref,
}: BiosampleResultsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Sample</th>
            <th className="px-3 py-2">Id</th>
            <th className="px-3 py-2">Type / origin</th>
            <th className="px-3 py-2">Matrices</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => {
            const selected = sample.id === selectedSampleId
            const matrixIds = sample.matrixIds ?? []
            return (
              <tr
                key={sample.id}
                className={`border-b border-border/60 ${
                  selected ? 'bg-[var(--scope-biosample-bg)]' : 'hover:bg-muted/30'
                }`}
              >
                <td className="px-3 py-2 font-medium">
                  <Link
                    href={buildSampleHref(sample.id)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {biosampleDisplayLabel(sample)}
                  </Link>
                </td>
                <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs">
                  <EntityRecordLink
                    kind="biosample"
                    id={sample.id}
                    title="Open biosample record"
                    className="truncate text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    {sample.id}
                  </EntityRecordLink>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {sample.sampleType?.label ??
                    sample.sampleOriginType?.label ??
                    '—'}
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {matrixCountForBiosample(sample)}
                  </span>
                  {matrixIds.slice(0, 2).map((mid) => (
                    <Link
                      key={mid}
                      href={`/matrices/${encodeURIComponent(mid)}`}
                      className="ml-2 text-xs text-primary underline"
                    >
                      {mid.length > 18 ? `${mid.slice(0, 16)}…` : mid}
                    </Link>
                  ))}
                  {matrixIds.length > 2 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      +{matrixIds.length - 2}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
