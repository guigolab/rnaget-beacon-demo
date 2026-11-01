'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { PageFrame } from '@/components/ui-kit'
import { getFilteringTerms, listMatrices, type FilteringTerm, type Matrix } from '@/lib/beacon'

export default function DatasetsPage() {
  const [matrices, setMatrices] = useState<Matrix[]>([])
  const [terms, setTerms] = useState<FilteringTerm[]>([])
  const [unit, setUnit] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    getFilteringTerms('/matrices/filtering_terms')
      .then((doc) => setTerms(doc.terms))
      .catch(() => {})
    listMatrices(0, 50).then((page) => setMatrices(page.results)).catch((e) => setError(String(e)))
  }, [])

  const unitTerm = terms.find((t) => t.id === 'matrix.unit')
  const filtered = unit
    ? matrices.filter((m) => m.expressionUnitAndScale?.unit === unit)
    : matrices

  return (
    <AppShell>
      <PageFrame>
        <h1 className="font-serif text-3xl text-[#15232c]">Dataset catalog</h1>
        <p className="mt-2 text-sm text-[#52666f]">
          Facets from <code className="rounded bg-[#edf5f5] px-1">GET /matrices/filtering_terms</code>.
        </p>
        {unitTerm?.values && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setUnit('')}
              className={`rounded-full px-3 py-1 text-xs ${!unit ? 'bg-[#0c7c86] text-white' : 'bg-white border'}`}
            >
              All
            </button>
            {unitTerm.values.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setUnit(v)}
                className={`rounded-full px-3 py-1 text-xs ${unit === v ? 'bg-[#0c7c86] text-white' : 'bg-white border'}`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {filtered.map((m) => (
            <Link
              key={m.matrixId}
              href={`/matrices/${encodeURIComponent(m.matrixId!)}`}
              className="rounded-xl border border-[#dfe7eb] bg-white p-4 transition hover:border-[#0c7c86]"
            >
              <h2 className="font-medium">{m.name ?? m.matrixId}</h2>
              <p className="mt-1 text-xs text-[#75858d]">
                {m.expressionUnitAndScale?.unit} · {m.annotation?.source} {m.annotation?.version} ·{' '}
                {m.dimensions?.features}×{m.dimensions?.biosamples}
              </p>
              <p className="mt-2 text-xs">
                {m.reproducible ? 'Reproducible' : 'Provenance incomplete'}
              </p>
            </Link>
          ))}
        </div>
      </PageFrame>
    </AppShell>
  )
}
