'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MatrixDetailClient } from '@/components/matrices/matrix-detail-client'
import { MatrixFilterSidebar } from '@/components/matrices/matrix-filter-sidebar'
import { MatrixQueryBar } from '@/components/matrices/matrix-query-bar'
import { MatrixResultsCards } from '@/components/matrices/matrix-results-cards'
import { LensChrome } from '@/components/shared/lens-chrome'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LensResultsPanel } from '@/components/shared/lens-results-panel'
import { PageFrame, PageHeader } from '@/components/ui-kit'
import { useLensList } from '@/hooks/use-lens-list'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
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
import { MATRIX_LENS_PAGE_SIZE, mergeMatrixLensFilters } from '@/lib/matrix-lens'

function MatricesListContent() {
  const search = useSearchParams()
  const router = useRouter()
  const scopeIndex = useMergedFilterScopeIndex()
  const lens = useMemo(
    () => parseMatrixLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const { matrixFilters } = lens

  const filterKeyLine = useMemo(
    () => matrixFilters.map((filter) => filterKey(filter)).join('|'),
    [matrixFilters]
  )
  const querySummary = useMemo(
    () => filtersQuerySummary(matrixFilters),
    [matrixFilters]
  )

  const filtersRef = useRef(matrixFilters)
  filtersRef.current = matrixFilters

  const listEnabled = matrixFilters.length > 0

  const list = useLensList<Matrix>({
    queryKey: filterKeyLine,
    pageSize: MATRIX_LENS_PAGE_SIZE,
    enabled: listEnabled,
    itemKey: (item) => item.id,
    fetchPage: (skip, limit, signal) =>
      listMatrices(skip, limit, {
        filters: filtersRef.current,
        granularity: 'record',
        signal,
      }),
  })

  const writeFilters = useCallback(
    (nextFilters: UiFilter[]) => {
      const params = matrixLensSearchParams({
        filters: dedupeFilters(nextFilters),
        matrix: null,
        index: scopeIndex,
      })
      router.replace(`/matrices/?${params.toString()}`)
    },
    [router, scopeIndex]
  )

  const canLoadMore =
    list.exists === true &&
    list.total != null &&
    list.items.length < list.total &&
    !list.loading &&
    !list.loadingMore

  const hasFilters = matrixFilters.length > 0

  return (
    <PageFrame>
      <PageHeader
        title="Matrices"
        description="Find expression matrices by assay, unit, annotation, assembly, or data source."
      />

      <LensChrome
        sidebar={
          <MatrixFilterSidebar
            activeFilters={matrixFilters}
            onAddFilter={(added) => writeFilters(mergeMatrixLensFilters(matrixFilters, added))}
          />
        }
        queryBar={
          <MatrixQueryBar
            filters={matrixFilters}
            onChange={writeFilters}
            probe={list}
            scopeIndex={scopeIndex}
          />
        }
        endpointLines={['GET or POST /matrices']}
        hasFilters={hasFilters}
        emptyState={{
          title: 'Start with a filter',
          description:
            'Use an example chip, type in the bar, or pick OBI / unit / source terms from the sidebar.',
        }}
        resultsPanel={
          <LensResultsPanel
            probe={list}
            querySummary={querySummary}
            previewLimit={list.items.length}
            previewCount={list.items.length}
            previewHint="GET or POST /matrices"
            noMatchesMessage="No matrices match these filters."
            loadErrorTitle="Could not load matrices"
            searchError={list.error}
            searchLoading={list.loading}
            hasMatches={list.items.length > 0}
            refreshingLabel="Refreshing matrix list…"
            canLoadMore={canLoadMore}
            loadingMore={list.loadingMore}
            pageSize={MATRIX_LENS_PAGE_SIZE}
            onLoadMore={list.loadMore}
            onClearFilters={() => writeFilters([])}
          >
            <MatrixResultsCards matrices={list.items} />
          </LensResultsPanel>
        }
      />
    </PageFrame>
  )
}

function MatricesContent() {
  const search = useSearchParams()
  const scopeIndex = useMergedFilterScopeIndex()
  const lens = useMemo(
    () => parseMatrixLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const matrixId = lens.matrix?.trim() || null

  if (matrixId) {
    return <MatrixDetailClient routeId={matrixId} />
  }
  return <MatricesListContent />
}

export function MatricesPageClient() {
  return (
    <LensPageShell>
      <MatricesContent />
    </LensPageShell>
  )
}
