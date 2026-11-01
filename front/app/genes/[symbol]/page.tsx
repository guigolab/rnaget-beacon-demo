'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { PageFrame } from '@/components/ui-kit'
import {
  listFeatures,
  listRelatedMatrices,
  queryCollection,
  type ExpressionSummary,
  type Matrix,
} from '@/lib/beacon'
import { compareMatrixSet } from '@/lib/comparability'

export default function GeneLensPage() {
  const params = useParams()
  const search = useSearchParams()
  const symbol = String(params.symbol ?? '').toUpperCase()
  const focusMatrix = search.get('matrix')
  const [matrices, setMatrices] = useState<Matrix[]>([])
  const [summaries, setSummaries] = useState<ExpressionSummary[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const feats = await listFeatures(0, 1, {
          filters: [{ kind: 'symbol', value: symbol }],
        })
        const feature = feats.results[0]
        if (!feature) {
          setError(`No feature found for symbol ${symbol}`)
          return
        }
        const related = await listRelatedMatrices('feature', feature.id, 0, 50)
        let mats = related.results
        if (focusMatrix) {
          mats = mats.filter((m) => m.matrixId === focusMatrix)
        }
        if (!cancelled) setMatrices(mats)
        const page = await queryCollection<ExpressionSummary>(
          `/features/${encodeURIComponent(feature.id)}/expression_summary`,
          { granularity: 'record', limit: 500 }
        )
        if (!cancelled) setSummaries(page.results)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Load failed')
      }
    }
    if (symbol) load()
    return () => {
      cancelled = true
    }
  }, [symbol, focusMatrix])

  const comparability = compareMatrixSet(matrices)
  const byMatrix = summaries.reduce<Record<string, ExpressionSummary[]>>((acc, row) => {
    const mid = row.matrixId ?? ''
    acc[mid] = acc[mid] ?? []
    acc[mid].push(row)
    return acc
  }, {})

  return (
    <AppShell>
      <PageFrame>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0c7c86]">
          Gene lens
        </p>
        <h1 className="mt-2 font-serif text-3xl text-[#15232c]">{symbol}</h1>
        <p className="mt-2 text-sm text-[#52666f]">
          One call to{' '}
          <code className="rounded bg-[#edf5f5] px-1">/features/&#123;id&#125;/expression_summary</code>{' '}
          (aggregates per matrix).
        </p>
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <p className="mt-4 rounded-lg border border-[#dfe7eb] bg-white px-3 py-2 text-sm">
          <span className="font-medium">{comparability.label}:</span> {comparability.detail}
        </p>
        <ul className="mt-6 space-y-4">
          {matrices.map((m) => (
            <li key={m.matrixId} className="rounded-xl border border-[#dfe7eb] bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium text-[#15232c]">{m.name ?? m.matrixId}</h2>
                <Link
                  href={`/matrices/${encodeURIComponent(m.matrixId!)}`}
                  className="text-xs text-[#0c7c86] hover:underline"
                >
                  Open workspace
                </Link>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-[#52666f]">
                {(byMatrix[m.matrixId!] ?? []).map((row) => (
                  <li key={row.id}>
                    n={row.n} · median={row.median?.toFixed(2) ?? '—'} TPM
                    {row.group?.label ? ` · ${row.group.label}` : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </PageFrame>
    </AppShell>
  )
}
