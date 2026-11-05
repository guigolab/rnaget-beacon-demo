'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BiosampleFilterSidebar } from '@/components/samples/biosample-filter-sidebar'
import { BiosampleMatrixStrips } from '@/components/samples/biosample-matrix-strips'
import { BiosampleOntologyMatrixHeatmap } from '@/components/samples/biosample-ontology-matrix-heatmap'
import { BiosampleQueryBar } from '@/components/samples/biosample-query-bar'
import { LensChrome } from '@/components/shared/lens-chrome'
import { LensMatrixScopeBanner } from '@/components/shared/lens-matrix-scope-banner'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LensResultsPanel } from '@/components/shared/lens-results-panel'
import { PageFrame, PageHeader } from '@/components/ui-kit'
import { useLensList } from '@/hooks/use-lens-list'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import {
  dedupeFilters,
  filterKey,
  filtersQuerySummary,
  listBiosamples,
  listMatrixBiosamples,
  parseSampleLensSearch,
  sampleLensSearchParams,
  type Biosample,
  type UiFilter,
} from '@/lib/beacon'
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
    () => biosampleFilters.map((filter) => filterKey(filter)).join('|'),
    [biosampleFilters]
  )
  const querySummary = useMemo(
    () => filtersQuerySummary(biosampleFilters),
    [biosampleFilters]
  )
  const termsPath = '/filtering_terms'

  const filtersRef = useRef(biosampleFilters)
  filtersRef.current = biosampleFilters
  const focusRef = useRef(focusMatrix)
  focusRef.current = focusMatrix

  const list = useLensList<Biosample>({
    queryKey: `${filterKeyLine}|${focusMatrix ?? ''}`,
    pageSize: SAMPLE_LENS_PAGE_SIZE,
    enabled: biosampleFilters.length > 0,
    itemKey: (item) => item.id,
    fetchPage: (skip, limit, signal) => {
      const filters = filtersRef.current
      const matrixId = focusRef.current
      if (matrixId) {
        return listMatrixBiosamples(matrixId, skip, limit, { filters, signal })
      }
      return listBiosamples(skip, limit, { filters, granularity: 'record', signal })
    },
  })

  const writeFilters = useCallback(
    (next: UiFilter[], matrix: string | null | undefined = focusMatrix) => {
      const params = sampleLensSearchParams({
        filters: dedupeFilters(next),
        matrix: matrix ?? undefined,
        sample: null,
        index: scopeIndex,
      })
      router.replace(`/biosamples/?${params.toString()}`)
    },
    [router, focusMatrix, scopeIndex]
  )

  const browseRecords = useCallback(
    (filter: UiFilter, matrixId: string) => {
      writeFilters(mergeSampleLensFilters(biosampleFilters, filter), matrixId)
    },
    [biosampleFilters, writeFilters]
  )

  const canLoadMore =
    list.exists === true &&
    list.total != null &&
    list.items.length < list.total &&
    !list.loading &&
    !list.loadingMore

  const clearMatrixHref = useMemo(() => {
    const params = sampleLensSearchParams({
      filters: biosampleFilters,
      index: scopeIndex,
    })
    return `/biosamples/?${params.toString()}`
  }, [biosampleFilters, scopeIndex])

  const endpoint = focusMatrix
    ? `POST /matrices/${focusMatrix}/biosamples · requestedGranularity: count`
    : 'POST /matrices/{id}/biosamples · requestedGranularity: count'

  return (
    <PageFrame>
      <PageHeader
        title="Biosamples"
        description="See which matrices include which tissues and cell types (counts by ontology), then drill into matching samples."
      />

      {focusMatrix && (
        <LensMatrixScopeBanner
          matrixId={focusMatrix}
          clearHref={clearMatrixHref}
          noun="biosamples"
        />
      )}

      <LensChrome
        sidebar={
          <BiosampleFilterSidebar
            termsPath={termsPath}
            source="GET /filtering_terms"
            activeFilters={biosampleFilters}
            onAddFilter={(added) =>
              writeFilters(mergeSampleLensFilters(biosampleFilters, added))
            }
          />
        }
        queryBar={
          <BiosampleQueryBar
            filters={biosampleFilters}
            onChange={(next) => writeFilters(next)}
            probe={list}
            scopeIndex={scopeIndex}
            termsPath={termsPath}
          />
        }
        endpointLines={[endpoint]}
        hasFilters={biosampleFilters.length > 0}
        alwaysShowResults
        emptyState={{
          title: 'Start with a filter',
          description:
            'Use an example chip, type in the bar, or pick a tissue term from the sidebar.',
        }}
        resultsPanel={
          <div className="space-y-8">
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Ontology × matrix coverage
              </p>
              <p className="text-xs text-muted-foreground">
                Rows are tissue/cell ontologies from each matrix&apos;s filtering
                terms. Cells show biosample counts (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  requestedGranularity: count
                </code>
                ).
              </p>
              <BiosampleOntologyMatrixHeatmap
                focusMatrix={focusMatrix}
                activeFilters={biosampleFilters}
                onAddFilter={(added) =>
                  writeFilters(mergeSampleLensFilters(biosampleFilters, added))
                }
                onBrowseRecords={browseRecords}
              />
            </div>

            {biosampleFilters.length > 0 && (
              <LensResultsPanel
                probe={list}
                querySummary={querySummary}
                previewLimit={list.items.length}
                previewCount={list.items.length}
                previewTruncatedSuffix="grouped by matrix"
                previewWhenShowing="Matching biosamples grouped into matrix strips; open a strip to explore that matrix workspace"
                noMatchesMessage="No biosamples match these filters."
                loadErrorTitle="Could not load biosamples"
                searchError={list.error}
                searchLoading={list.loading}
                hasMatches={list.items.length > 0}
                refreshingLabel="Refreshing biosample list…"
                canLoadMore={canLoadMore}
                loadingMore={list.loadingMore}
                pageSize={SAMPLE_LENS_PAGE_SIZE}
                onLoadMore={list.loadMore}
                onClearFilters={() => writeFilters([])}
              >
                <BiosampleMatrixStrips
                  samples={list.items}
                  focusMatrix={focusMatrix}
                />
              </LensResultsPanel>
            )}
          </div>
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
