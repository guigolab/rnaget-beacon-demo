'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { EndpointNote, PageFrame } from '@/components/ui-kit'
import {
  getEntryTypes,
  getFilteringTerms,
  getInfo,
  type BeaconInfo,
  type EntryTypeInfo,
  type FilteringResource,
  type FilteringTerm,
} from '@/lib/beacon'
import { DEMO_SCENARIOS } from '@/lib/demo-scenarios'

const ROUTES: Record<string, string> = {
  matrix: '/matrices',
  feature: '/features',
  biosample: '/biosamples',
}

function organizationName(info: BeaconInfo | null) {
  const org = info?.organization
  if (!org) return ''
  if (typeof org === 'string') return org
  return org.name ?? org.id ?? ''
}

export function HomePage() {
  const [info, setInfo] = useState<BeaconInfo | null>(null)
  const [entryTypes, setEntryTypes] = useState<Record<string, EntryTypeInfo> | null>(null)
  const [document, setDocument] = useState<{
    resources: FilteringResource[]
    filteringTerms: FilteringTerm[]
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([getInfo(), getEntryTypes(), getFilteringTerms()])
      .then(([nextInfo, nextTypes, terms]) => {
        if (cancelled) return
        setInfo(nextInfo)
        setEntryTypes(nextTypes)
        setDocument({ resources: terms.resources, filteringTerms: terms.terms })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Beacon info failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const org = organizationName(info)
  const types = entryTypes ? Object.values(entryTypes) : []

  return (
    <AppShell>
      <PageFrame>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0c7c86]">
          RNA-Get Beacon
        </p>
        <h1 className="mt-2 font-serif text-4xl tracking-tight text-[#15232c]">
          {info?.name ?? 'RNA-Get Beacon'}
        </h1>
        <p className="mt-2 font-mono text-xs text-[#829198]">
          {[info?.id, info?.apiVersion, info?.environment, org].filter(Boolean).join(' · ') ||
            (error || 'Contacting beacon…')}
        </p>
        {info?.description && (
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#52666f]">{info.description}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {DEMO_SCENARIOS.map((scenario) => (
            <Link
              key={scenario.id}
              href={scenario.href}
              title={scenario.description}
              className="rounded-full border border-[#0c7c86]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#0c6870] hover:bg-[#edf5f5]"
            >
              {scenario.label}
            </Link>
          ))}
        </div>
        <EndpointNote>GET /info</EndpointNote>
        {types.length > 0 && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {types.map((entry) => {
              const id = entry.id ?? ''
              const href = ROUTES[id]
              const body = (
                <>
                  <p className="font-medium text-[#1f343d]">{entry.name || id}</p>
                  <p className="mt-1 font-mono text-[11px] text-[#829198]">
                    {href ? `GET ${href}` : 'Nested under a matrix'}
                  </p>
                  {entry.description && (
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#71818a]">
                      {entry.description}
                    </p>
                  )}
                </>
              )
              return href ? (
                <Link
                  key={id}
                  href={href}
                  className="rounded-xl border border-[#dce7ea] bg-white p-5 transition hover:border-[#0c7c86]"
                >
                  {body}
                </Link>
              ) : (
                <div key={id} className="rounded-xl border border-[#dce7ea] bg-white p-5">
                  {body}
                </div>
              )
            })}
          </div>
        )}
        <section className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0c7c86]">
            Filtering terms
          </p>
          <EndpointNote>GET /filtering_terms</EndpointNote>
          {!document && !error && (
            <p className="mt-4 text-sm text-[#71818a]">Loading filtering terms…</p>
          )}
          {document && (
            <pre className="mt-4 max-h-[32rem] overflow-auto rounded-xl border border-[#dce7ea] bg-white p-5 font-mono text-xs leading-5 text-[#27404a]">
              {JSON.stringify(document, null, 2)}
            </pre>
          )}
        </section>
      </PageFrame>
    </AppShell>
  )
}
