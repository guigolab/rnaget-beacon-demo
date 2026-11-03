'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { formatHeatmapValue } from '@/lib/heatmap-expression'

function parseDraft(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6)
}

function draftFrom(value: number): string {
  if (!Number.isFinite(value)) return ''
  const text = String(value)
  if (text.length <= 12) return text
  return String(Number(value.toPrecision(8)))
}

type MatrixRangeFilterProps = {
  matrixMin: number
  matrixMax: number
  unit?: string
  minValue?: number
  maxValue?: number
  onApply: (minValue?: number, maxValue?: number) => void
  trailing?: ReactNode
}

export function MatrixRangeFilter({
  matrixMin,
  matrixMax,
  unit,
  minValue,
  maxValue,
  onApply,
  trailing,
}: MatrixRangeFilterProps) {
  const unitHint = unit ? ` ${unit}` : ''
  const [minDraft, setMinDraft] = useState(() => draftFrom(minValue ?? matrixMin))
  const [maxDraft, setMaxDraft] = useState(() => draftFrom(maxValue ?? matrixMax))
  const [error, setError] = useState('')

  useEffect(() => {
    setMinDraft(draftFrom(minValue ?? matrixMin))
    setMaxDraft(draftFrom(maxValue ?? matrixMax))
    setError('')
  }, [minValue, maxValue, matrixMin, matrixMax])

  function apply() {
    const minEmpty = !minDraft.trim()
    const maxEmpty = !maxDraft.trim()
    if (minEmpty && maxEmpty) {
      setError('')
      onApply(undefined, undefined)
      return
    }
    const parsedMin = parseDraft(minDraft)
    const parsedMax = parseDraft(maxDraft)
    if (parsedMin == null || parsedMax == null) {
      setError('Enter both a minimum and a maximum, or clear both.')
      return
    }
    if (parsedMin > parsedMax) {
      setError('Minimum must be less than or equal to maximum.')
      return
    }
    setError('')
    onApply(
      nearlyEqual(parsedMin, matrixMin) ? undefined : parsedMin,
      nearlyEqual(parsedMax, matrixMax) ? undefined : parsedMax
    )
  }

  const filtered = minValue != null || maxValue != null
  const catalogHint = `${formatHeatmapValue(matrixMin)}–${formatHeatmapValue(matrixMax)}${unitHint}`

  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-medium text-muted-foreground">Value range</span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <label className="sr-only" htmlFor="matrix-range-min">
          Minimum
        </label>
        <input
          id="matrix-range-min"
          aria-label={`Minimum${unitHint}`}
          value={minDraft}
          inputMode="decimal"
          onChange={(event) => setMinDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
          className="h-9 w-[4.75rem] shrink-0 rounded-md border border-border bg-background px-2 text-right font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
          –
        </span>
        <label className="sr-only" htmlFor="matrix-range-max">
          Maximum
        </label>
        <input
          id="matrix-range-max"
          aria-label={`Maximum${unitHint}`}
          value={maxDraft}
          inputMode="decimal"
          onChange={(event) => setMaxDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
          className="h-9 w-[4.75rem] shrink-0 rounded-md border border-border bg-background px-2 text-right font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <Button type="button" size="sm" variant="outline" className="h-9 px-2.5" onClick={apply}>
          Apply
        </Button>
        {filtered && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 px-2"
            onClick={() => onApply(undefined, undefined)}
          >
            Reset
          </Button>
        )}
        {trailing != null && (
          <>
            <span className="mx-0.5 shrink-0 text-sm text-muted-foreground" aria-hidden>
              |
            </span>
            {trailing}
          </>
        )}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground" title={catalogHint}>
        Catalog {catalogHint}. Keep rows with a value in range.
      </p>
      {error && (
        <p className="text-[11px] text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  )
}
