'use client'

import { useEffect, useState } from 'react'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'
import { getBiosample } from '@/lib/beacon'
import type { Biosample, OntologyTerm } from '@/lib/beacon/types'
import { biosampleDisplayLabel } from '@/lib/sample-lens'
import { formatHeatmapValue } from '@/lib/heatmap-expression'

type BiosampleExtremeCardProps = {
  biosampleId: string
  role: 'min' | 'max' | 'sole'
  expressionValue?: number
  unit?: string
  compact?: boolean
}

function ontologyTerms(sample: Biosample): OntologyTerm[] {
  const terms: OntologyTerm[] = []
  const push = (t?: OntologyTerm | string) => {
    if (!t) return
    if (typeof t === 'string') {
      terms.push({ id: t, label: t })
      return
    }
    if (t.id || t.label) terms.push(t)
  }
  push(sample.sampleOriginDetail)
  push(sample.sampleOriginType)
  push(sample.sampleType)
  if (typeof sample.biosampleStatus === 'object') push(sample.biosampleStatus)
  const seen = new Set<string>()
  return terms.filter((t) => {
    const key = t.id ?? t.label ?? ''
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const ROLE_SHORT = {
  min: 'Min',
  max: 'Max',
  sole: 'Sample',
} as const

export function BiosampleExtremeCard({
  biosampleId,
  role,
  expressionValue,
  unit,
  compact = false,
}: BiosampleExtremeCardProps) {
  const { openRecordSheet } = useEntityRecordSheet()
  const [sample, setSample] = useState<Biosample | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getBiosample(biosampleId)
      .then((row) => {
        if (!cancelled) setSample(row)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [biosampleId])

  const terms = sample ? ontologyTerms(sample) : []
  const label = sample ? biosampleDisplayLabel(sample) : biosampleId

  if (compact) {
    return (
      <div className="min-w-0 flex-1 rounded-md border border-[var(--scope-biosample-border)]/30 bg-[var(--scope-biosample-bg)]/25 px-2 py-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">
            {ROLE_SHORT[role]}
          </span>
          {expressionValue != null && Number.isFinite(expressionValue) && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">
              {formatHeatmapValue(expressionValue)}
            </span>
          )}
        </div>
        {loading ? (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">…</p>
        ) : (
          <button
            type="button"
            className="mt-0.5 block max-w-full truncate text-left text-[11px] font-medium text-primary underline-offset-2 hover:underline"
            title={biosampleId}
            onClick={() => openRecordSheet('biosample', biosampleId)}
          >
            {label}
          </button>
        )}
        {terms.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-0.5">
            {terms.slice(0, 3).map((term) => (
              <span
                key={term.id ?? term.label}
                className="max-w-[5.5rem] truncate rounded border border-border/70 bg-background/70 px-1 py-px text-[9px]"
                title={term.id}
              >
                {term.label ?? term.id}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <article className="min-w-0 flex-1 rounded-lg border border-[var(--scope-biosample-border)]/35 bg-[var(--scope-biosample-bg)]/30 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {ROLE_SHORT[role]}
      </p>
      {expressionValue != null && Number.isFinite(expressionValue) && (
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
          {formatHeatmapValue(expressionValue)}
          {unit ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
          ) : null}
        </p>
      )}
      {loading && (
        <p className="mt-2 text-[11px] text-muted-foreground">Loading biosample…</p>
      )}
      {!loading && sample && (
        <>
          <button
            type="button"
            className="mt-1 block text-left text-sm font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => openRecordSheet('biosample', sample.id)}
          >
            {label}
          </button>
          {terms.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {terms.map((term) => (
                <li
                  key={term.id ?? term.label}
                  className="max-w-full truncate rounded border border-border/80 bg-background/80 px-1.5 py-0.5 text-[10px] text-foreground"
                  title={term.id}
                >
                  {term.label ?? term.id}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  )
}
