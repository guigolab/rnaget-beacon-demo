'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { COLOR_MISSING } from '@/components/heatmap-colors'
import {
  isAbortError,
  listExpressionValues,
  listMatrixBiosamples,
  type ExpressionSummary,
  type Feature,
} from '@/lib/beacon'
import {
  cellKey,
  featureTokens,
  formatHeatmapValue,
  HEATMAP_PREVIEW_COLS,
  heatFill,
  heatTextColor,
  indexExpression,
  nativeFeatureId,
} from '@/lib/heatmap-expression'

type GeneMatrixPreviewRowProps = {
  matrixId: string
  feature: Feature
  symbol: string
  summary?: ExpressionSummary
}

export function GeneMatrixPreviewRow({
  matrixId,
  feature,
  symbol,
  summary,
}: GeneMatrixPreviewRowProps) {
  const [colSkip, setColSkip] = useState(0)
  const [bioTotal, setBioTotal] = useState(0)
  const [biosampleIds, setBiosampleIds] = useState<string[]>([])
  const [values, setValues] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const bioPage = await listMatrixBiosamples(
          matrixId,
          colSkip,
          HEATMAP_PREVIEW_COLS,
          controller.signal
        )
        if (cancelled) return
        const samples = bioPage.results
        setBioTotal(bioPage.total ?? samples.length)
        setBiosampleIds(samples.map((s) => s.id))

        if (!samples.length) {
          setValues(new Map())
          return
        }

        const tokens = [...new Set(featureTokens(feature))].slice(0, 100)
        const featureIDList = tokens.join(',')
        const biosampleIDList = samples.map((s) => s.id).join(',')
        const limit = Math.min(1000, Math.max(tokens.length * samples.length, 1))

        const evPage = await listExpressionValues(matrixId, {
          featureIDList,
          biosampleIDList,
          limit,
          signal: controller.signal,
        })
        if (cancelled) return
        const indexed = indexExpression([feature], evPage.results)
        setValues(indexed.values)
      } catch (err: unknown) {
        if (cancelled || isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Failed to load expression window')
        setValues(new Map())
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [matrixId, feature, colSkip])

  const rowId = nativeFeatureId(feature)
  const rowValues = useMemo(() => {
    return biosampleIds.map((bid) => values.get(cellKey(rowId, bid)))
  }, [biosampleIds, rowId, values])

  const numeric = rowValues.filter((v): v is number => v != null && Number.isFinite(v))
  const min = numeric.length ? Math.min(...numeric) : 0
  const max = numeric.length ? Math.max(...numeric) : 1

  const maxColSkip = Math.max(0, bioTotal - HEATMAP_PREVIEW_COLS)

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
      {summary && (
        <p className="mb-2 text-xs text-muted-foreground">
          Matrix summary · n={summary.n} · median={summary.median?.toFixed(2) ?? '—'}
        </p>
      )}
      {loading && <p className="text-xs text-muted-foreground">Loading sample window…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!loading && !error && (
        <>
          <div className="overflow-x-auto">
            <div
              className="inline-grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${Math.max(biosampleIds.length, 1)}, minmax(3.5rem, 1fr))`,
              }}
            >
              {biosampleIds.map((bid) => (
                <div
                  key={bid}
                  className="truncate px-1 text-center font-mono text-[10px] text-muted-foreground"
                  title={bid}
                >
                  {bid.length > 10 ? `${bid.slice(0, 8)}…` : bid}
                </div>
              ))}
              {biosampleIds.map((bid) => {
                const value = values.get(cellKey(rowId, bid))
                const bg =
                  value === undefined ? COLOR_MISSING : heatFill(value, min, max)
                const color =
                  value === undefined ? undefined : heatTextColor(value, min, max)
                return (
                  <div
                    key={`cell-${bid}`}
                    className="flex h-10 items-center justify-center rounded text-xs font-medium tabular-nums"
                    style={{ backgroundColor: bg, color }}
                    title={value === undefined ? bid : `${bid}: ${value}`}
                  >
                    {value === undefined ? '—' : formatHeatmapValue(value)}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              disabled={colSkip <= 0}
              onClick={() => setColSkip((s) => Math.max(0, s - HEATMAP_PREVIEW_COLS))}
            >
              <ChevronLeft className="h-3 w-3" aria-hidden />
              Samples
            </button>
            <span className="text-xs text-muted-foreground">
              {bioTotal ? colSkip + 1 : 0}–{Math.min(colSkip + HEATMAP_PREVIEW_COLS, bioTotal)} of{' '}
              {bioTotal}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              disabled={colSkip >= maxColSkip}
              onClick={() =>
                setColSkip((s) => Math.min(maxColSkip, s + HEATMAP_PREVIEW_COLS))
              }
            >
              Samples
              <ChevronRight className="h-3 w-3" aria-hidden />
            </button>
            <Link
              href={`/matrices/${encodeURIComponent(matrixId)}/?genes=${encodeURIComponent(symbol)}`}
              className="ml-auto text-xs text-primary underline"
            >
              Open full heatmap
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
