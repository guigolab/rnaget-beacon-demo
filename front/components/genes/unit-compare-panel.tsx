'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Matrix } from '@/lib/beacon/types'
import { MatrixUnitToggle } from '@/components/genes/matrix-unit-toggle'
import { type CompareBucket, groupMatricesForCompare } from '@/lib/comparability'
import { medianForMatrix } from '@/lib/gene-lens'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

type UnitComparePanelProps = {
  symbol?: string
  matrices: Matrix[]
  summariesByMatrix: Record<string, ExpressionSummary[]>
  activeUnitKey: string | null
  onUnitKeyChange: (key: string) => void
}

function UnitChart({
  bucket,
  summariesByMatrix,
}: {
  bucket: CompareBucket
  summariesByMatrix: Record<string, ExpressionSummary[]>
}) {
  const labels = bucket.matrices.map((m) => m.name ?? m.matrixId ?? '')
  const data = bucket.matrices.map((m) => {
    const mid = m.matrixId ?? ''
    return medianForMatrix(summariesByMatrix[mid] ?? []) ?? 0
  })
  const unit = bucket.matrices[0]?.expressionUnitAndScale?.unit ?? ''

  const option = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 48, right: 16, top: 24, bottom: 64 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { rotate: 30, fontSize: 10 },
      },
      yAxis: { type: 'value', name: unit ? `Median (${unit})` : 'Median' },
      series: [
        {
          name: 'Median',
          type: 'bar',
          data,
        },
      ],
    }),
    [labels, data, unit]
  )

  if (bucket.matrices.length === 0) return null

  if (bucket.comparability.level === 'incompatible' && bucket.matrices.length > 1) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {bucket.matrices.map((m) => {
          const mid = m.matrixId ?? ''
          const med = medianForMatrix(summariesByMatrix[mid] ?? [])
          const u = m.expressionUnitAndScale?.unit ?? '—'
          return (
            <div key={mid} className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">{m.name ?? mid}</p>
              <p className="text-muted-foreground">
                Median: {med?.toFixed(2) ?? '—'} {u}
              </p>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="h-72 border border-border bg-card p-2">
      <ReactECharts option={option} style={{ height: '100%' }} />
    </div>
  )
}

export function UnitComparePanel({
  matrices,
  summariesByMatrix,
  activeUnitKey,
  onUnitKeyChange,
}: UnitComparePanelProps) {
  const buckets = useMemo(() => groupMatricesForCompare(matrices), [matrices])
  const active =
    buckets.find((b) => b.key === activeUnitKey) ?? buckets[0] ?? null

  if (!matrices.length) {
    return (
      <p className="text-sm text-muted-foreground">No expression summaries for this feature.</p>
    )
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Cross-matrix comparison</h3>
      <MatrixUnitToggle
        buckets={buckets}
        activeKey={active?.key ?? null}
        onChange={onUnitKeyChange}
      />
      {active && (
        <>
          <p className="text-sm text-muted-foreground">
            {active.comparability.label}
          </p>
          <UnitChart bucket={active} summariesByMatrix={summariesByMatrix} />
        </>
      )}
    </section>
  )
}
