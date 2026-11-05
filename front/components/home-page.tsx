'use client'

import { useEffect, useState } from 'react'
import { BeaconMapSection } from '@/components/home/beacon-map-section'
import { EntryTypeCards } from '@/components/home/entry-type-cards'
import { ExploreHowItWorks } from '@/components/home/explore-how-it-works'
import { HomeHero } from '@/components/home/home-hero'
import { KpiCards } from '@/components/home/kpi-cards'
import { QueryExamplesSection } from '@/components/home/query-examples-section'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { ErrorNote } from '@/components/status'
import { PageFrame } from '@/components/ui-kit'
import { useHomeCounts } from '@/hooks/use-home-counts'
import {
  getBeaconMap,
  getEntryTypes,
  getFilteringTerms,
  getInfo,
  type BeaconInfo,
  type BeaconMap,
  type EntryTypeInfo,
  type FilteringResource,
  type FilteringTerm,
} from '@/lib/beacon'
import { cn } from '@/lib/utils'

type HomeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      info: BeaconInfo
      entryTypes: EntryTypeInfo[]
      terms: FilteringTerm[]
      resources: FilteringResource[]
      map: BeaconMap | null
    }

const ANCHORS = [
  { href: '#overview', label: 'Overview' },
  { href: '#entities', label: 'Entities' },
  { href: '#queries', label: 'Queries' },
  { href: '#explore', label: 'Explore' },
] as const

function HomeAnchorNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="On this page"
      className={cn(
        'flex flex-wrap gap-1 border-b border-border pb-3 text-sm',
        className
      )}
    >
      {ANCHORS.map((anchor) => (
        <a
          key={anchor.href}
          href={anchor.href}
          className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {anchor.label}
        </a>
      ))}
    </nav>
  )
}

export function HomePage() {
  const [state, setState] = useState<HomeState>({ status: 'loading' })
  const counts = useHomeCounts()

  useEffect(() => {
    let cancelled = false

    Promise.all([
      getInfo(),
      getEntryTypes(),
      getFilteringTerms(),
      getBeaconMap().catch(() => null),
    ])
      .then(([info, entryTypes, filtering, map]) => {
        if (cancelled) return
        setState({
          status: 'ready',
          info,
          entryTypes: Object.values(entryTypes),
          terms: filtering.terms,
          resources: filtering.resources,
          map,
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
            <HomeAnchorNav />
            <HomeHero info={null} />
            <KpiCards counts={counts} />
            <ErrorNote message={state.message} />
          </div>
        )}

        {state.status === 'ready' && (
          <div className="space-y-10">
            <HomeAnchorNav />
            <HomeHero info={state.info} />
            <KpiCards counts={counts} />

            {state.entryTypes.length > 0 && (
              <EntryTypeCards
                entryTypes={state.entryTypes}
                terms={state.terms}
                resources={state.resources}
              />
            )}

            <BeaconMapSection map={state.map} />
            <QueryExamplesSection terms={state.terms} />
            <ExploreHowItWorks />
          </div>
        )}
      </PageFrame>
    </LensPageShell>
  )
}

function HomeSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      <div className="flex gap-2">
        <div className="h-7 w-16 animate-pulse rounded bg-muted" />
        <div className="h-7 w-16 animate-pulse rounded bg-muted" />
        <div className="h-7 w-16 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3 border-b border-border pb-6">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="flex gap-1.5">
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
    </div>
  )
}
