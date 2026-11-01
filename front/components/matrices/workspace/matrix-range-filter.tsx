'use client'

import { useEffect, useState } from 'react'
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
}

export function MatrixRangeFilter({
  matrixMin,
  matrixMax,
  unit,
  minValue,
  maxValue,
  onApply,
}: MatrixRangeFilterProps) {
  const unitHint = unit ? ` (${unit})` : ''
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

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Value range{unitHint}
      </legend>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Catalog {formatHeatmapValue(matrixMin)}–{formatHeatmapValue(matrixMax)}
        {unit ? ` ${unit}` : ''}. Rows stay when a feature has a value inside the range.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-muted-foreground" htmlFor="matrix-range-min">
          Min
        </label>
        <input
          id="matrix-range-min"
          value={minDraft}
          inputMode="decimal"
          onChange={(event) => setMinDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
          className="h-8 w-[5.5rem] rounded-md border border-border bg-background px-2 text-right font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <label className="text-[11px] text-muted-foreground" htmlFor="matrix-range-max">
          Max
        </label>
        <input
          id="matrix-range-max"
          value={maxDraft}
          inputMode="decimal"
          onChange={(event) => setMaxDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
          className="h-8 w-[5.5rem] rounded-md border border-border bg-background px-2 text-right font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <Button type="button" size="sm" variant="outline" onClick={apply}>
          Apply
        </Button>
        {filtered && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onApply(undefined, undefined)}
          >
            Reset
          </Button>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-destructive" role="status">
          {error}
        </p>
      )}
    </fieldset>
  )
}
