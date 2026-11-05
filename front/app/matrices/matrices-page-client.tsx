'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MatrixFilterSidebar } from '@/components/matrices/matrix-filter-sidebar'
import { MatrixQueryBar } from '@/components/matrices/matrix-query-bar'
import { MatrixResultsCards } from '@/components/matrices/matrix-results-cards'
import { Button } from '@/components/ui/button'
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
  isAbortError,
  listFeatureMatrices,
  listFeatures,
  listMatrices,
  matrixLensSearchParams,
  parseMatrixLensSearch,
  type Matrix,
  type UiFilter,
} from '@/lib/beacon'
import { MATRIX_LENS_PAGE_SIZE, mergeMatrixLensFilters } from '@/lib/matrix-lens'

function MatricesContent() {
  const search = useSearchParams()
  const router = useRouter()
  const scopeIndex = useMergedFilterScopeIndex()
  const lens = useMemo(
    () => parseMatrixLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const { matrixFilters, gene } = lens

  const [geneDraft, setGeneDraft] = useState(gene ?? '')
  const [geneError, setGeneError] = useState('')
  const [resolvedFeatureId, setResolvedFeatureId] = useState<string | null>(null)
  const [resolvingGene, setResolvingGene] = useState(false)

  useEffect(() => {
    setGeneDraft(gene ?? '')
  }, [gene])

  useEffect(() => {
    if (!gene) {
      setResolvedFeatureId(null)
      setResolvingGene(false)
      setGeneError('')
      return
    }
    const controller = new AbortController()
    setResolvingGene(true)
    setGeneError('')
    setResolvedFeatureId(null)
    listFeatures(0, 5, {
      filters: [{ kind: 'custom', id: `symbol:${gene}` }],
      granularity: 'record',
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return
        const hit = page.results[0]
        if (!hit?.id) {
          setGeneError(`No feature matched “${gene}”.`)
          setResolvedFeatureId(null)
          return
        }
        setResolvedFeatureId(hit.id)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setGeneError(err instanceof Error ? err.message : 'Could not resolve gene')
        setResolvedFeatureId(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setResolvingGene(false)
      })
    return () => controller.abort()
  }, [gene])

  const filterKeyLine = useMemo(
    () =>
      [
        matrixFilters.map((filter) => filterKey(filter)).join('|'),
        gene ?? '',
        resolvedFeatureId ?? '',
      ].join('\u0000'),
    [matrixFilters, gene, resolvedFeatureId]
  )
  const querySummary = useMemo(() => {
    const parts = [filtersQuerySummary(matrixFilters)]
    if (gene) parts.push(`${gene} high on matrix range`)
    return parts.filter((part) => part && part !== 'your filters').join(' · ') || 'your filters'
  }, [matrixFilters, gene])

  const filtersRef = useRef(matrixFilters)
  filtersRef.current = matrixFilters
  const featureIdRef = useRef(resolvedFeatureId)
  featureIdRef.current = resolvedFeatureId

  const listEnabled =
    matrixFilters.length > 0 || (Boolean(gene) && Boolean(resolvedFeatureId))

  const list = useLensList<Matrix>({
    queryKey: filterKeyLine,
    pageSize: MATRIX_LENS_PAGE_SIZE,
    enabled: listEnabled && !resolvingGene,
    itemKey: (item) => item.matrixId,
    fetchPage: (skip, limit, signal) => {
      const featureId = featureIdRef.current
      if (featureId) {
        return listFeatureMatrices(featureId, {
          filters: [
            {
              kind: 'expression',
              id: 'expression.percentile',
              operator: '>=',
              value: '90',
            },
            ...filtersRef.current,
          ],
          skip,
          limit,
          signal,
        })
      }
      return listMatrices(skip, limit, {
        filters: filtersRef.current,
        granularity: 'record',
        signal,
      })
    },
  })

  const writeState = useCallback(
    (nextFilters: UiFilter[], nextGene: string | null) => {
      const params = matrixLensSearchParams({
        filters: dedupeFilters(nextFilters),
        matrix: null,
        gene: nextGene,
        index: scopeIndex,
      })
      router.replace(`/matrices/?${params.toString()}`)
    },
    [router, scopeIndex]
  )

  const writeFilters = useCallback(
    (next: UiFilter[]) => writeState(next, gene),
    [writeState, gene]
  )

  function applyGene() {
    const trimmed = geneDraft.trim()
    if (!trimmed) {
      writeState(matrixFilters, null)
      setGeneError('')
      return
    }
    writeState(matrixFilters, trimmed)
  }

  const canLoadMore =
    list.exists === true &&
    list.total != null &&
    list.items.length < list.total &&
    !list.loading &&
    !list.loadingMore

  const hasFilters = matrixFilters.length > 0 || Boolean(gene)
  const searchError = geneError || list.error
  const searchLoading = resolvingGene || list.loading

  return (
    <PageFrame>
      <PageHeader
        title="Matrices"
        description="Find expression matrices by assay, feature type, unit, annotation, or assembly."
      />

      <LensChrome
        sidebar={
          <MatrixFilterSidebar
            activeFilters={matrixFilters}
            onAddFilter={(added) => writeFilters(mergeMatrixLensFilters(matrixFilters, added))}
          />
        }
        queryBar={
          <div className="space-y-2">
            <MatrixQueryBar
              filters={matrixFilters}
              onChange={writeFilters}
              probe={list}
              scopeIndex={scopeIndex}
            />
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 space-y-1">
                <span className="block text-[11px] font-medium text-muted-foreground">
                  Gene expression
                </span>
                <input
                  value={geneDraft}
                  placeholder="Gene symbol (top 10%)"
                  aria-label="Gene symbol for top-percentile matrices"
                  onChange={(event) => {
                    setGeneDraft(event.target.value)
                    if (geneError) setGeneError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      applyGene()
                    }
                  }}
                  className="h-9 w-full max-w-xs rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                />
              </label>
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={applyGene}>
                Apply
              </Button>
              {gene && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={() => writeState(matrixFilters, null)}
                >
                  Clear gene
                </Button>
              )}
              <p className="w-full text-[10px] text-muted-foreground">
                Resolves a feature, then lists matrices via{' '}
                <span className="font-mono">/features/&#123;id&#125;/matrices</span> with{' '}
                <span className="font-mono">expression.percentile:&gt;=:90</span>.
              </p>
            </div>
          </div>
        }
        endpointLines={
          gene
            ? ['GET or POST /features/{id}/matrices · expression.percentile:>=:90']
            : ['GET or POST /matrices']
        }
        hasFilters={hasFilters}
        emptyState={{
          title: 'Start with a filter',
          description:
            'Use an example chip, type in the bar, pick OBI/SO terms from the sidebar, or enter a gene for top-percentile expression in a matrix.',
        }}
        resultsPanel={
          <LensResultsPanel
            probe={list}
            querySummary={querySummary}
            previewLimit={list.items.length}
            previewCount={list.items.length}
            previewHint={
              gene
                ? 'GET or POST /features/{id}/matrices (expression.percentile:>=:90)'
                : 'GET or POST /matrices'
            }
            noMatchesMessage="No matrices match these filters."
            loadErrorTitle="Could not load matrices"
            searchError={searchError}
            searchLoading={searchLoading}
            hasMatches={list.items.length > 0}
            refreshingLabel="Refreshing matrix list…"
            canLoadMore={canLoadMore}
            loadingMore={list.loadingMore}
            pageSize={MATRIX_LENS_PAGE_SIZE}
            onLoadMore={list.loadMore}
            onClearFilters={() => writeState([], null)}
          >
            <MatrixResultsCards matrices={list.items} />
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
