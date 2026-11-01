'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { PageFrame } from '@/components/ui-kit'
import { getFilteringTerms, listBiosamples, type Biosample, type FilteringTerm } from '@/lib/beacon'

export default function SamplesPage() {
  const [terms, setTerms] = useState<FilteringTerm[]>([])
  const [samples, setSamples] = useState<Biosample[]>([])
  const [sex, setSex] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    getFilteringTerms('/biosamples/filtering_terms')
      .then((doc) => setTerms(doc.terms))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const filters = sex ? [{ kind: 'sex' as const, value: sex }] : undefined
    listBiosamples(0, 20, { filters })
      .then((page) => setSamples(page.results))
      .catch((e) => setError(String(e)))
  }, [sex])

  const sexTerm = terms.find((t) => t.id === 'sex')

  return (
    <AppShell>
      <PageFrame>
        <h1 className="font-serif text-3xl text-[#15232c]">Sample lens</h1>
        <p className="mt-2 text-sm text-[#52666f]">
          Browse biosamples and jump to matrices that include them.
        </p>
        {sexTerm?.values && (
          <div className="mt-4 flex flex-wrap gap-2">
            {['', ...sexTerm.values].map((v) => (
              <button
                key={v || 'all'}
                type="button"
                onClick={() => setSex(v)}
                className={`rounded-full px-3 py-1 text-xs ${sex === v ? 'bg-[#0c7c86] text-white' : 'bg-white border'}`}
              >
                {v || 'All sexes'}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <ul className="mt-6 space-y-2">
          {samples.map((b) => (
            <li key={b.id} className="rounded-lg border border-[#dfe7eb] bg-white px-3 py-2 text-sm">
              <span className="font-mono">{b.id}</span>
              {b.sampleOriginDetail?.label && (
                <span className="ml-2 text-[#52666f]">{b.sampleOriginDetail.label}</span>
              )}
              {(b.matrixIds ?? []).slice(0, 3).map((mid) => (
                <Link
                  key={mid}
                  href={`/matrices/${encodeURIComponent(mid)}`}
                  className="ml-2 text-xs text-[#0c7c86] hover:underline"
                >
                  {mid}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      </PageFrame>
    </AppShell>
  )
}
