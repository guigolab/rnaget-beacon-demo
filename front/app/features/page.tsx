'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FeatureMatrixHeatmap } from '@/components/genes/feature-matrix-heatmap'
import { GeneFeatureQueryBar } from '@/components/genes/gene-feature-query-bar'
import { GeneFilterSidebar } from '@/components/genes/gene-filter-sidebar'
import { LensChrome } from '@/components/shared/lens-chrome'
import { LensMatrixScopeBanner } from '@/components/shared/lens-matrix-scope-banner'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { LensResultsPanel } from '@/components/shared/lens-results-panel'
import { PageFrame, PageHeader } from '@/components/ui-kit'
import {
  dedupeFilters,
  filterKey,
  filtersQuerySummary,
  geneLensSearchParams,
  getFeature,
  listFeatures,
  parseGeneLensSearch,
  type Feature,
  type UiFilter,
} from '@/lib/beacon'
import { useGeneFilterProbe } from '@/hooks/use-gene-filter-probe'
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
  const lens = useMemo(() => parseGeneLensSearch(search), [search])
  const { featureFilters, feature: featureParam, matrix: focusMatrix, unit: unitParam } =
    lens

  const filterKeyLine = useMemo(
    () => featureFilters.map((f) => filterKey(f)).join('|'),
    [featureFilters]
  )
  const querySummary = useMemo(
    () => filtersQuerySummary(featureFilters),
    [featureFilters]
  )

  const [matches, setMatches] = useState<Feature[]>([])
  const [displayLimit, setDisplayLimit] = useState(GENE_LENS_PAGE_SIZE)
  const [searchError, setSearchError] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const probe = useGeneFilterProbe(featureFilters)

  const selectedFeature = useMemo(
    () => resolveSelectedFeature(matches, featureParam),
    [matches, featureParam]
  )

  const activeUnitKey = unitParam ?? null

  useEffect(() => {
    setDisplayLimit(GENE_LENS_PAGE_SIZE)
  }, [filterKeyLine])

  const writeFilters = useCallback(
    (next: UiFilter[]) => {
      const params = geneLensSearchParams({
        filters: dedupeFilters(next),
        matrix: focusMatrix,
        feature: null,
      })
      router.replace(`/features/?${params.toString()}`)
    },
    [router, focusMatrix]
  )

  const setUnitKey = useCallback(
    (key: string) => {
      const params = geneLensSearchParams({
        filters: featureFilters,
        feature: featureParam,
        matrix: focusMatrix,
        unit: key,
      })
      router.replace(`/features/?${params.toString()}`)
    },
    [router, featureFilters, featureParam, focusMatrix]
  )

  useEffect(() => {
    if (featureFilters.length === 0) {
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
        const page = await listFeatures(0, displayLimit, {
          filters: featureFilters,
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
  }, [filterKeyLine, featureFilters, probe.loading, probe.exists, displayLimit])

  useEffect(() => {
    if (!featureParam || searchLoading || probe.exists !== true) return
    if (matches.some((f) => f.id === featureParam)) return

    let cancelled = false
    getFeature(featureParam)
      .then((feature) => {
        if (cancelled || !feature) return
        setMatches((prev) => {
          if (prev.some((f) => f.id === feature.id)) return prev
          return [feature, ...prev].slice(0, displayLimit)
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [featureParam, matches, searchLoading, probe.exists, displayLimit])

  const canLoadMore =
    probe.exists === true &&
    probe.total != null &&
    matches.length < probe.total &&
    !searchLoading

  const clearMatrixHref = useMemo(() => {
    const params = geneLensSearchParams({
      filters: featureFilters,
      feature: featureParam,
      unit: unitParam,
    })
    return `/features/?${params.toString()}`
  }, [featureFilters, featureParam, unitParam])

  const pageTitle = selectedFeature
    ? featureDisplayLabel(selectedFeature)
    : 'Features'

  return (
    <PageFrame>
      <PageHeader
        title={pageTitle}
        description={
          selectedFeature
            ? `${querySummary} · ${featureAnnotationResource(selectedFeature) ?? 'feature'}`
            : 'Query genomic features, then inspect matrix medians in the heatmap.'
        }
      />

      {focusMatrix && (
        <LensMatrixScopeBanner matrixId={focusMatrix} clearHref={clearMatrixHref} />
      )}

      <LensChrome
        sidebar={
          <GeneFilterSidebar
            activeFilters={featureFilters}
            onAddFilter={(added) =>
              writeFilters(mergeGeneLensFilters(featureFilters, added))
            }
          />
        }
        queryBar={
          <GeneFeatureQueryBar
            filters={featureFilters}
            onChange={writeFilters}
            probe={probe}
          />
        }
        endpointLines={['GET or POST /features']}
        hasFilters={featureFilters.length > 0}
        emptyState={{
          title: 'Start with a filter',
          description:
            'Use an example chip, type in the bar, or pick a Sequence Ontology term from the sidebar.',
        }}
        resultsPanel={
          <LensResultsPanel
            probe={probe}
            querySummary={querySummary}
            previewLimit={displayLimit}
            previewCount={matches.length}
            previewTruncatedSuffix="matrix medians from expression_summary"
            previewWhenShowing="Matrix medians from GET /features/{id}/expression_summary"
            noMatchesMessage="No features match these filters at boolean granularity."
            loadErrorTitle="Could not load features"
            searchError={searchError}
            searchLoading={searchLoading}
            hasMatches={matches.length > 0}
            refreshingLabel="Refreshing feature list…"
            canLoadMore={canLoadMore}
            pageSize={GENE_LENS_PAGE_SIZE}
            onLoadMore={() => setDisplayLimit((n) => n + GENE_LENS_PAGE_SIZE)}
          >
            <FeatureMatrixHeatmap
              features={matches}
              focusMatrix={focusMatrix}
              selectedFeatureId={selectedFeature?.id ?? null}
              activeFilters={featureFilters}
              onAddFilter={(added) =>
                writeFilters(mergeGeneLensFilters(featureFilters, added))
              }
              unitKey={activeUnitKey}
              onUnitKeyChange={setUnitKey}
            />
          </LensResultsPanel>
        }
        detail={
          selectedFeature ? (
            <>
              <h3 className="text-sm font-semibold">Selected feature</h3>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {selectedFeature.id}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => openRecordSheet('feature', selectedFeature.id)}
                >
                  Full feature record
                </button>
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
