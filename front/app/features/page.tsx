'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FeatureMatrixHeatmap } from '@/components/genes/feature-matrix-heatmap'
import { GeneFeatureQueryBar } from '@/components/genes/gene-feature-query-bar'
import { GeneFilterSidebar } from '@/components/genes/gene-filter-sidebar'
import { LensChrome } from '@/components/shared/lens-chrome'
import { LensMatrixScopeBanner } from '@/components/shared/lens-matrix-scope-banner'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LensResultsPanel } from '@/components/shared/lens-results-panel'
import { Button } from '@/components/ui/button'
import { PageFrame, PageHeader } from '@/components/ui-kit'
import { useLensList } from '@/hooks/use-lens-list'
import { useMergedFilterScopeIndex } from '@/hooks/use-merged-filter-scope-index'
import {
  dedupeFilters,
  filterKey,
  filtersQuerySummary,
  geneLensSearchParams,
  getFeature,
  listFeatures,
  listMatrixFeatures,
  parseGeneLensSearch,
  type Feature,
  type UiFilter,
} from '@/lib/beacon'
import {
  featureAnnotationResource,
  featureDisplayLabel,
  GENE_LENS_PAGE_SIZE,
  mergeGeneLensFilters,
  resolveSelectedFeature,
} from '@/lib/gene-lens'

function FeaturesLensContent() {
  const { openRecordSheet } = useEntityRecordSheet()
  const search = useSearchParams()
  const router = useRouter()
  const scopeIndex = useMergedFilterScopeIndex()
  const lens = useMemo(
    () => parseGeneLensSearch(search, scopeIndex),
    [search, scopeIndex]
  )
  const { featureFilters, feature: featureParam, matrix: focusMatrix } = lens

  const filterKeyLine = useMemo(
    () => featureFilters.map((filter) => filterKey(filter)).join('|'),
    [featureFilters]
  )
  const querySummary = useMemo(
    () => filtersQuerySummary(featureFilters),
    [featureFilters]
  )
  const termsPath = '/filtering_terms'

  const filtersRef = useRef(featureFilters)
  filtersRef.current = featureFilters
  const focusRef = useRef(focusMatrix)
  focusRef.current = focusMatrix

  const list = useLensList<Feature>({
    queryKey: `${filterKeyLine}|${focusMatrix ?? ''}`,
    pageSize: GENE_LENS_PAGE_SIZE,
    enabled: featureFilters.length > 0,
    itemKey: (item) => item.id,
    fetchPage: (skip, limit, signal) => {
      const filters = filtersRef.current
      const matrixId = focusRef.current
      if (matrixId) {
        return listMatrixFeatures(matrixId, skip, limit, { filters, signal })
      }
      return listFeatures(skip, limit, { filters, granularity: 'record', signal })
    },
  })

  const [pinned, setPinned] = useState<Feature | null>(null)
  const pinnedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!featureParam) {
      pinnedFor.current = null
      setPinned(null)
      return
    }
    if (list.items.some((item) => item.id === featureParam)) return
    if (pinnedFor.current === featureParam) return
    pinnedFor.current = featureParam
    let cancelled = false
    getFeature(featureParam)
      .then((feature) => {
        if (!cancelled) setPinned(feature)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [featureParam, list.items])

  const matches = useMemo(() => {
    if (!pinned || list.items.some((item) => item.id === pinned.id)) return list.items
    return [pinned, ...list.items]
  }, [list.items, pinned])

  const selectedFeature = useMemo(
    () => resolveSelectedFeature(matches, featureParam),
    [matches, featureParam]
  )

  const writeFilters = useCallback(
    (next: UiFilter[]) => {
      const params = geneLensSearchParams({
        filters: dedupeFilters(next),
        matrix: focusMatrix,
        feature: null,
        index: scopeIndex,
      })
      router.replace(`/features/?${params.toString()}`)
    },
    [router, focusMatrix, scopeIndex]
  )

  const canLoadMore =
    list.exists === true &&
    list.total != null &&
    list.items.length < list.total &&
    !list.loading &&
    !list.loadingMore

  const clearMatrixHref = useMemo(() => {
    const params = geneLensSearchParams({
      filters: featureFilters,
      feature: featureParam,
      index: scopeIndex,
    })
    return `/features/?${params.toString()}`
  }, [featureFilters, featureParam, scopeIndex])

  const pageTitle = selectedFeature ? featureDisplayLabel(selectedFeature) : 'Features'
  const endpoint = focusMatrix
    ? `GET or POST /matrices/${focusMatrix}/features`
    : 'GET or POST /features'

  return (
    <PageFrame>
      <PageHeader
        title={pageTitle}
        description={
          selectedFeature
            ? `${querySummary} · ${featureAnnotationResource(selectedFeature) ?? 'feature'}`
            : 'Query genomic features, then inspect expression bands across matrices.'
        }
      />

      {focusMatrix && (
        <LensMatrixScopeBanner
          matrixId={focusMatrix}
          clearHref={clearMatrixHref}
          noun="features"
        />
      )}

      <LensChrome
        sidebar={
          <GeneFilterSidebar
            termsPath={termsPath}
            source="GET /filtering_terms"
            activeFilters={featureFilters}
            onAddFilter={(added) => writeFilters(mergeGeneLensFilters(featureFilters, added))}
          />
        }
        queryBar={
          <GeneFeatureQueryBar
            filters={featureFilters}
            onChange={writeFilters}
            probe={list}
            scopeIndex={scopeIndex}
            termsPath={termsPath}
          />
        }
        endpointLines={[endpoint]}
        hasFilters={featureFilters.length > 0}
        emptyState={{
          title: 'Start with a filter',
          description:
            'Use an example chip, type in the bar, or pick a term from the sidebar.',
        }}
        resultsPanel={
          <LensResultsPanel
            probe={list}
            querySummary={querySummary}
            previewLimit={matches.length}
            previewCount={matches.length}
            previewTruncatedSuffix="banded heatmap via POST /features/{id}/matrices"
            previewWhenShowing="Expression percentile bands from POST /features/{id}/matrices (expression.percentile.* · matrixIDList)"
            noMatchesMessage="No features match these filters."
            loadErrorTitle="Could not load features"
            searchError={list.error}
            searchLoading={list.loading}
            hasMatches={matches.length > 0}
            refreshingLabel="Refreshing feature list…"
            canLoadMore={canLoadMore}
            loadingMore={list.loadingMore}
            pageSize={GENE_LENS_PAGE_SIZE}
            onLoadMore={list.loadMore}
            onClearFilters={() => writeFilters([])}
          >
            <FeatureMatrixHeatmap
              features={matches}
              focusMatrix={focusMatrix}
              selectedFeatureId={selectedFeature?.id ?? null}
              activeFilters={featureFilters}
              onAddFilter={(added) => writeFilters(mergeGeneLensFilters(featureFilters, added))}
            />
          </LensResultsPanel>
        }
        detail={
          selectedFeature ? (
            <>
              <h3 className="text-sm font-semibold">Selected feature</h3>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{selectedFeature.id}</p>
              <div className="mt-3">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => openRecordSheet('feature', selectedFeature.id)}
                >
                  Full feature record
                </Button>
              </div>
            </>
          ) : undefined
        }
      />
    </PageFrame>
  )
}

export default function FeaturesPage() {
  return (
    <LensPageShell>
      <FeaturesLensContent />
    </LensPageShell>
  )
}
