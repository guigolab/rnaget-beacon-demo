'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MatrixFilterSidebar } from '@/components/matrices/matrix-filter-sidebar'
import { MatrixQueryBar } from '@/components/matrices/matrix-query-bar'
import { MatrixResultsTable } from '@/components/matrices/matrix-results-table'
import { LensChrome } from '@/components/shared/lens-chrome'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LensResultsPanel } from '@/components/shared/lens-results-panel'
import { PageFrame, PageHeader } from '@/components/ui-kit'
import { useMatrixFilterProbe } from '@/hooks/use-matrix-filter-probe'
import {
  dedupeFilters,
  filterKey,
  filtersQuerySummary,
  getMatrix,
  listMatrices,
  matrixLensSearchParams,
  parseMatrixLensSearch,
  type Matrix,
  type UiFilter,
} from '@/lib/beacon'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import {
  MATRIX_LENS_PAGE_SIZE,
  matrixDisplayLabel,
  mergeMatrixLensFilters,
  resolveSelectedMatrix,
} from '@/lib/matrix-lens'

function MatricesContent() {
  const search = useSearchParams()
  const router = useRouter()
  const scopeIndex = useMergedFilterScopeIndex()
  const lens = useMemo(
    () => parseMatrixLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const { matrixFilters, matrix: matrixParam } = lens

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

  const selectedMatrix = useMemo(
    () => resolveSelectedMatrix(matches, matrixParam),
    [matches, matrixParam]
  )

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

  const buildMatrixRowHref = useCallback(
    (matrixId: string) => {
      const params = matrixLensSearchParams({
        filters: matrixFilters,
        matrix: matrixId,
      })
      return `/matrices/?${params.toString()}`
    },
    [matrixFilters]
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

  useEffect(() => {
    if (!matrixParam || searchLoading || probe.exists !== true) return
    if (matches.some((m) => m.matrixId === matrixParam)) return

    let cancelled = false
    getMatrix(matrixParam)
      .then((matrix) => {
        if (cancelled || !matrix) return
        setMatches((prev) => {
          const id = matrix.matrixId
          if (!id || prev.some((m) => m.matrixId === id)) return prev
          return [matrix, ...prev].slice(0, displayLimit)
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [matrixParam, matches, searchLoading, probe.exists, displayLimit])

  const canLoadMore =
    probe.exists === true &&
    probe.total != null &&
    matches.length < probe.total &&
    !searchLoading

  const pageTitle = selectedMatrix
    ? matrixDisplayLabel(selectedMatrix)
    : 'Matrix lens'

  return (
    <PageFrame>
      <PageHeader
        title={pageTitle}
        description={
          selectedMatrix
            ? querySummary
            : 'Find expression matrices by assay, feature type, unit, annotation, or assembly.'
        }
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
            <MatrixResultsTable
              matrices={matches}
              selectedMatrixId={selectedMatrix?.matrixId ?? null}
              buildMatrixRowHref={buildMatrixRowHref}
            />
          </LensResultsPanel>
        }
        detail={
          selectedMatrix ? (
            <>
              <h3 className="text-sm font-semibold">Selected matrix</h3>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {selectedMatrix.matrixId}
              </p>
              {selectedMatrix.description && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedMatrix.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                <Link
                  href={`/matrices/${encodeURIComponent(selectedMatrix.matrixId ?? '')}/`}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Open matrix workspace
                </Link>
              </div>
            </>
          ) : undefined
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
