'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BiosampleFilterSidebar } from '@/components/samples/biosample-filter-sidebar'
import { BiosampleQueryBar } from '@/components/samples/biosample-query-bar'
import { BiosampleResultsCards } from '@/components/samples/biosample-results-cards'
import { LensChrome } from '@/components/shared/lens-chrome'
import { LensMatrixScopeBanner } from '@/components/shared/lens-matrix-scope-banner'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LensResultsPanel } from '@/components/shared/lens-results-panel'
import { PageFrame, PageHeader } from '@/components/ui-kit'
import { useBiosampleFilterProbe } from '@/hooks/use-biosample-filter-probe'
import {
  dedupeFilters,
  filterKey,
  filtersQuerySummary,
  listBiosamples,
  parseSampleLensSearch,
  sampleLensSearchParams,
  type Biosample,
  type UiFilter,
} from '@/lib/beacon'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import { mergeSampleLensFilters, SAMPLE_LENS_PAGE_SIZE } from '@/lib/sample-lens'

function BiosamplesLensContent() {
  const search = useSearchParams()
  const router = useRouter()
  const scopeIndex = useMergedFilterScopeIndex()
  const lens = useMemo(
    () => parseSampleLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const { biosampleFilters, matrix: focusMatrix } = lens

  const filterKeyLine = useMemo(
    () => biosampleFilters.map((f) => filterKey(f)).join('|'),
    [biosampleFilters]
  )
  const querySummary = useMemo(
    () => filtersQuerySummary(biosampleFilters),
    [biosampleFilters]
  )

  const [matches, setMatches] = useState<Biosample[]>([])
  const [displayLimit, setDisplayLimit] = useState(SAMPLE_LENS_PAGE_SIZE)
  const [searchError, setSearchError] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const probe = useBiosampleFilterProbe(biosampleFilters)

  useEffect(() => {
    setDisplayLimit(SAMPLE_LENS_PAGE_SIZE)
  }, [filterKeyLine])

  const writeFilters = useCallback(
    (next: UiFilter[]) => {
      const params = sampleLensSearchParams({
        filters: dedupeFilters(next),
        matrix: focusMatrix,
        sample: null,
      })
      router.replace(`/biosamples/?${params.toString()}`)
    },
    [router, focusMatrix]
  )

  useEffect(() => {
    if (biosampleFilters.length === 0) {
      setMatches([])
      setSearchError('')
      setSearchLoading(false)
      return
    }
    if (probe.loading || probe.exists !== true) {
      setMatches([])
      setSearchError('')
      setSearchLoading(false)
      return
    }

    let cancelled = false
    async function loadMatches() {
      const showBlockingLoad = matches.length === 0
      if (showBlockingLoad) setSearchLoading(true)
      setSearchError('')
      try {
        const page = await listBiosamples(0, displayLimit, {
          filters: biosampleFilters,
          granularity: 'record',
        })
        if (cancelled) return
        setMatches(page.results)
      } catch (err: unknown) {
        if (!cancelled) {
          setSearchError(err instanceof Error ? err.message : 'Cannot reach the beacon.')
          setMatches([])
        }
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }
    loadMatches()
    return () => {
      cancelled = true
    }
  }, [filterKeyLine, biosampleFilters, probe.loading, probe.exists, displayLimit])

  const canLoadMore =
    probe.exists === true &&
    probe.total != null &&
    matches.length < probe.total &&
    !searchLoading

  const clearMatrixHref = useMemo(() => {
    const params = sampleLensSearchParams({
      filters: biosampleFilters,
    })
    return `/biosamples/?${params.toString()}`
  }, [biosampleFilters])

  return (
    <PageFrame>
      <PageHeader
        title="Biosamples"
        description="Query biosamples by tissue, ontology, or sample metadata, then open matrices."
      />

      {focusMatrix && (
        <LensMatrixScopeBanner matrixId={focusMatrix} clearHref={clearMatrixHref} />
      )}

      <LensChrome
        sidebar={
          <BiosampleFilterSidebar
            activeFilters={biosampleFilters}
            onAddFilter={(added) =>
              writeFilters(mergeSampleLensFilters(biosampleFilters, added))
            }
          />
        }
        queryBar={
          <BiosampleQueryBar
            filters={biosampleFilters}
            onChange={writeFilters}
            probe={probe}
          />
        }
        endpointLines={['GET or POST /biosamples']}
        hasFilters={biosampleFilters.length > 0}
        emptyState={{
          title: 'Start with a filter',
          description:
            'Use an example chip, type in the bar, or pick a tissue term from the sidebar.',
        }}
        resultsPanel={
          <LensResultsPanel
            probe={probe}
            querySummary={querySummary}
            previewLimit={displayLimit}
            previewCount={matches.length}
            previewHint="GET or POST /biosamples"
            noMatchesMessage="No biosamples match these filters at boolean granularity."
            loadErrorTitle="Could not load biosamples"
            searchError={searchError}
            searchLoading={searchLoading}
            hasMatches={matches.length > 0}
            refreshingLabel="Refreshing biosample list…"
            canLoadMore={canLoadMore}
            pageSize={SAMPLE_LENS_PAGE_SIZE}
            onLoadMore={() => setDisplayLimit((n) => n + SAMPLE_LENS_PAGE_SIZE)}
          >
            <BiosampleResultsCards samples={matches} focusMatrix={focusMatrix} />
          </LensResultsPanel>
        }
      />
    </PageFrame>
  )
}

export default function BiosamplesPage() {
  return (
    <LensPageShell>
      <BiosamplesLensContent />
    </LensPageShell>
  )
}
