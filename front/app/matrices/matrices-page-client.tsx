'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MatrixFilterSidebar } from '@/components/matrices/matrix-filter-sidebar'
import { MatrixQueryBar } from '@/components/matrices/matrix-query-bar'
import { MatrixResultsCards } from '@/components/matrices/matrix-results-cards'
import { LensChrome } from '@/components/shared/lens-chrome'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LensResultsPanel } from '@/components/shared/lens-results-panel'
import { PageFrame, PageHeader } from '@/components/ui-kit'
import { useMatrixFilterProbe } from '@/hooks/use-matrix-filter-probe'
import {
  dedupeFilters,
  filterKey,
  filtersQuerySummary,
  listMatrices,
  matrixLensSearchParams,
  parseMatrixLensSearch,
  type Matrix,
  type UiFilter,
} from '@/lib/beacon'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import {
  MATRIX_LENS_PAGE_SIZE,
  mergeMatrixLensFilters,
} from '@/lib/matrix-lens'

function MatricesContent() {
  const search = useSearchParams()
  const router = useRouter()
  const scopeIndex = useMergedFilterScopeIndex()
  const lens = useMemo(
    () => parseMatrixLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const { matrixFilters } = lens

  const filterKeyLine = useMemo(
    () => matrixFilters.map((f) => filterKey(f)).join('|'),
    [matrixFilters]
  )
  const querySummary = useMemo(
    () => filtersQuerySummary(matrixFilters),
    [matrixFilters]
  )

  const [matches, setMatches] = useState<Matrix[]>([])
  const [displayLimit, setDisplayLimit] = useState(MATRIX_LENS_PAGE_SIZE)
  const [searchError, setSearchError] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const probe = useMatrixFilterProbe(matrixFilters)

  useEffect(() => {
    setDisplayLimit(MATRIX_LENS_PAGE_SIZE)
  }, [filterKeyLine])

  const writeFilters = useCallback(
    (next: UiFilter[]) => {
      const params = matrixLensSearchParams({
        filters: dedupeFilters(next),
        matrix: null,
      })
      router.replace(`/matrices/?${params.toString()}`)
    },
    [router]
  )

  useEffect(() => {
    if (matrixFilters.length === 0) {
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
        const page = await listMatrices(0, displayLimit, {
          filters: matrixFilters,
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
  }, [filterKeyLine, matrixFilters, probe.loading, probe.exists, displayLimit])

  const canLoadMore =
    probe.exists === true &&
    probe.total != null &&
    matches.length < probe.total &&
    !searchLoading

  return (
    <PageFrame>
      <PageHeader
        title="Matrix lens"
        description="Find expression matrices by assay, feature type, unit, annotation, or assembly."
      />

      <LensChrome
        sidebar={
          <MatrixFilterSidebar
            activeFilters={matrixFilters}
            onAddFilter={(added) =>
              writeFilters(mergeMatrixLensFilters(matrixFilters, added))
            }
          />
        }
        queryBar={
          <MatrixQueryBar
            filters={matrixFilters}
            onChange={writeFilters}
            probe={probe}
          />
        }
        endpointLines={['GET or POST /matrices']}
        hasFilters={matrixFilters.length > 0}
        emptyState={{
          title: 'Start with a filter',
          description:
            'Use an example chip, type in the bar, or pick OBI/SO terms or matrix facets from the sidebar.',
        }}
        resultsPanel={
          <LensResultsPanel
            probe={probe}
            querySummary={querySummary}
            previewLimit={displayLimit}
            previewCount={matches.length}
            previewHint="GET or POST /matrices"
            noMatchesMessage="No matrices match these filters at boolean granularity."
            loadErrorTitle="Could not load matrices"
            searchError={searchError}
            searchLoading={searchLoading}
            hasMatches={matches.length > 0}
            refreshingLabel="Refreshing matrix list…"
            canLoadMore={canLoadMore}
            pageSize={MATRIX_LENS_PAGE_SIZE}
            onLoadMore={() => setDisplayLimit((n) => n + MATRIX_LENS_PAGE_SIZE)}
          >
            <MatrixResultsCards matrices={matches} />
          </LensResultsPanel>
        }
      />
    </PageFrame>
  )
}

export function MatricesPageClient() {
  return (
    <LensPageShell>
      <MatricesContent />
    </LensPageShell>
  )
}
