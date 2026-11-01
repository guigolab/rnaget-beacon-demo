'use client'

import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { SelectionTray } from '@/components/selection-tray'
import { PageFrame } from '@/components/ui-kit'
import { getMatrix, listMatrixExpressionSummary, type Matrix } from '@/lib/beacon'
import { compareMatrixSet } from '@/lib/comparability'

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false })

export default function ComparePage() {
  const search = useSearchParams()
  const genes = (search.get('genes') ?? 'ALB,APOA1').split(',').map((g) => g.trim())
  const matrixIds = (search.get('matrices') ?? 'GTEx-v8-Liver,GTEx-v8-Adipose-Subcutaneous')
    .split(',')
    .map((m) => m.trim())
  const [matrices, setMatrices] = useState<Matrix[]>([])
  const [means, setMeans] = useState<number[][]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const mats = await Promise.all(matrixIds.map((id) => getMatrix(id)))
        if (cancelled) return
        setMatrices(mats)
        const rows: number[][] = []
        for (const gene of genes) {
          const row: number[] = []
          for (const m of mats) {
            const page = await listMatrixExpressionSummary(m.matrixId!, {
              featureIDList: gene,
            })
            row.push(page.results[0]?.median ?? 0)
          }
          rows.push(row)
        }
        if (!cancelled) setMeans(rows)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Compare failed')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [genes.join(','), matrixIds.join(',')])

  const badge = compareMatrixSet(matrices)
  const option = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: matrixIds },
      yAxis: { type: 'value', name: 'Median TPM' },
      series: genes.map((gene, i) => ({
        name: gene,
        type: 'bar',
        data: means[i] ?? [],
      })),
    }),
    [genes, matrixIds, means]
  )

  return (
    <AppShell>
      <PageFrame>
        <h1 className="font-serif text-3xl text-[#15232c]">Cross-matrix compare</h1>
        <div className="mt-3">
          <SelectionTray />
        </div>
        <p className="mt-2 rounded-lg border border-[#dfe7eb] bg-white px-3 py-2 text-sm">
          {badge.label}: {badge.detail}
        </p>
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-6 h-80 rounded-xl border border-[#dfe7eb] bg-white p-2">
          {means.length > 0 && <ReactECharts option={option} style={{ height: '100%' }} />}
        </div>
      </PageFrame>
    </AppShell>
  )
}
