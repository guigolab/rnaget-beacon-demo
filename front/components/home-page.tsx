'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { EntryTypeCards } from '@/components/home/entry-type-cards'
import { FilteringNamespaceChips } from '@/components/home/filtering-namespace-chips'
import { FilteringResourceCards } from '@/components/home/filtering-resource-cards'
import { ScopeLegend } from '@/components/home/scope-legend'
import { ErrorNote, LoadingNote } from '@/components/status'
import { EndpointNote, PageFrame, PageHeader } from '@/components/ui-kit'
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

function organizationName(info: BeaconInfo | null) {
  const org = info?.organization
  if (!org) return ''
  if (typeof org === 'string') return org
  return org.name ?? org.id ?? ''
}

export function HomePage() {
  const [info, setInfo] = useState<BeaconInfo | null>(null)
  const [entryTypes, setEntryTypes] = useState<Record<string, EntryTypeInfo> | null>(null)
  const [terms, setTerms] = useState<FilteringTerm[]>([])
  const [resources, setResources] = useState<FilteringResource[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([getInfo(), getEntryTypes(), getFilteringTerms()])
      .then(([nextInfo, nextTypes, doc]) => {
        if (cancelled) return
        setInfo(nextInfo)
        setEntryTypes(nextTypes)
        setTerms(doc.terms)
        setResources(doc.resources)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Cannot reach the beacon.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const org = organizationName(info)
  const types = entryTypes ? Object.values(entryTypes) : []
  const pending = !error && info === null

  return (
    <AppShell>
      <PageFrame>
        <PageHeader
          title={info?.name ?? 'RNA-Get Beacon'}
          description={
            info?.description ??
            'Explore RNA expression matrices, genes, and biosamples through the Beacon v2 API.'
          }
        />
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {[info?.id, info?.apiVersion, info?.environment, org].filter(Boolean).join(' · ') ||
            (pending ? 'Loading…' : '')}
        </p>
        <EndpointNote>GET /info</EndpointNote>
        {error && (
          <div className="mt-4">
            <ErrorNote message={error} />
          </div>
        )}
        {pending && <LoadingNote />}
        {!pending && !error && (
          <>
            <section className="mt-6">
              <h2 className="text-sm font-medium">Demo scenarios</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {DEMO_SCENARIOS.map((scenario) => (
                  <Link
                    key={scenario.id}
                    href={scenario.href}
                    className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm transition-shadow hover:shadow-md"
                  >
                    <span className="font-medium text-primary">{scenario.label}</span>
                    <p className="mt-1 text-muted-foreground">{scenario.description}</p>
                  </Link>
                ))}
              </div>
            </section>

            <section className="mt-8 space-y-3">
              <h2 className="text-sm font-medium">Scope legend</h2>
              <p className="text-sm text-muted-foreground">
                Colors match entry-type accents and filtering-term chips below.
              </p>
              <ScopeLegend />
            </section>

            {types.length > 0 && (
              <section className="mt-8 space-y-3">
                <h2 className="text-sm font-medium">Entry types</h2>
                <EndpointNote>GET /entry_types</EndpointNote>
                <EntryTypeCards entryTypes={types} />
              </section>
            )}

            <div className="mt-8 space-y-8">
              <FilteringResourceCards resources={resources} terms={terms} />
              <FilteringNamespaceChips terms={terms} />
            </div>
          </>
        )}
      </PageFrame>
    </AppShell>
  )
}
