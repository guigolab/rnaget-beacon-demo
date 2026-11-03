'use client'

import { useEffect, useState } from 'react'
import { BeaconMapSection } from '@/components/home/beacon-map-section'
import { EntryTypeCards } from '@/components/home/entry-type-cards'
import { HomeHero } from '@/components/home/home-hero'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { ErrorNote } from '@/components/status'
import { PageFrame } from '@/components/ui-kit'
import {
  getBeaconConfiguration,
  getBeaconMap,
  getEntryTypes,
  getFilteringTerms,
  getInfo,
  getServiceInfo,
  type BeaconConfiguration,
  type BeaconInfo,
  type BeaconMap,
  type EntryTypeInfo,
  type FilteringResource,
  type FilteringTerm,
  type ServiceInfo,
} from '@/lib/beacon'

type HomeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      info: BeaconInfo
      service: ServiceInfo | null
      entryTypes: EntryTypeInfo[]
      terms: FilteringTerm[]
      resources: FilteringResource[]
      map: BeaconMap | null
      configuration: BeaconConfiguration | null
    }

export function HomePage() {
  const [state, setState] = useState<HomeState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    Promise.all([
      getInfo(),
      getServiceInfo().catch(() => null),
      getEntryTypes(),
      getFilteringTerms(),
      getBeaconMap().catch(() => null),
      getBeaconConfiguration().catch(() => null),
    ])
      .then(([info, service, entryTypes, filtering, map, configuration]) => {
        if (cancelled) return
        setState({
          status: 'ready',
          info,
          service,
          entryTypes: Object.values(entryTypes),
          terms: filtering.terms,
          resources: filtering.resources,
          map,
          configuration,
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Cannot reach the beacon.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <LensPageShell>
      <PageFrame>
        {state.status === 'loading' && <HomeSkeleton />}

        {state.status === 'error' && (
          <div className="space-y-4">
            <HomeHero info={null} service={null} configuration={null} />
            <ErrorNote message={state.message} />
          </div>
        )}

        {state.status === 'ready' && (
          <div className="space-y-10">
            <HomeHero
              info={state.info}
              service={state.service}
              configuration={state.configuration}
            />

            {state.entryTypes.length > 0 && (
              <EntryTypeCards
                entryTypes={state.entryTypes}
                terms={state.terms}
                resources={state.resources}
              />
            )}

            <BeaconMapSection map={state.map} />
          </div>
        )}
      </PageFrame>
    </LensPageShell>
  )
}

function HomeSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      <div className="space-y-6">
        <div className="space-y-3 border-b border-border pb-6">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="flex gap-1.5">
            <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  )
}
