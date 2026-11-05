'use client'

import { Popover } from '@base-ui/react/popover'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FilteringTermBrowser } from '@/components/shared/filtering-term-browser'
import { Button } from '@/components/ui/button'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { MatrixQueryUpdate } from '@/hooks/use-matrix-query-state'
import { dedupeFilters, filterKey, buildFilterScopeIndex } from '@/lib/beacon'
import { listMatrixFeatures } from '@/lib/beacon/client'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import { catalogLabelById, filterChipDisplay } from '@/lib/gene-filter-labels'
import { browsableTerms, lensQueryPlaceholder } from '@/lib/lens-catalog'
import {
  matrixHeatmapBiosampleExamples,
  matrixHeatmapFeatureExamples,
  type MatrixExample,
} from '@/lib/matrix-workspace'
import {
  biosampleIdListCsv,
  featureIdListCsv,
  interpretBiosampleQueryToken,
  interpretFeatureQueryToken,
  matrixWorkspaceHasConstraints,
  querySuggestions,
  type MatrixWorkspaceQuery,
} from '@/lib/matrix-workspace-query'
import { mergeGeneLensFilters } from '@/lib/gene-lens'
import { mergeSampleLensFilters } from '@/lib/sample-lens'
import { MatrixBiotypeFamilyChips } from './matrix-biotype-family-chips'
import { MatrixRangeFilter } from './matrix-range-filter'
import { QueryChipInput, type QueryChip, type QueryExampleChip } from './query-chip-input'

function shorten(id: string) {
  return id.length > 22 ? `${id.slice(0, 20)}…` : id
}

function exampleChips(
  examples: MatrixExample[],
  onSelect: (filter: UiFilter) => void
): QueryExampleChip[] {
  return examples.map((example) => ({
    key: filterKey(example.filter),
    label: example.label,
    onSelect: () => onSelect(example.filter),
  }))
}

type MatrixQueryPanelProps = {
  matrix: Matrix
  query: MatrixWorkspaceQuery
  onPatch: (update: MatrixQueryUpdate) => void
  onClear: () => void
  /** When `matrix.dimensions.biosamples` is missing, used to hide biosample query for ≤2 samples. */
  biosampleTotalFallback?: number
}

function CatalogBrowsePopover({
  label,
  count,
  loading,
  children,
}: {
  label: string
  count: number
  loading: boolean
  children: ReactNode
}) {
  if (!loading && count === 0) return null
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      >
        {loading ? label : `${label} (${count.toLocaleString()})`}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-[200]">
          <Popover.Popup className="z-[200] w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
            <div className="border-b border-border px-3 py-2">
              <Popover.Title className="text-xs font-semibold text-foreground">
                {label}
              </Popover.Title>
            </div>
            <div className="max-h-[min(70vh,24rem)] overflow-y-auto p-2">{children}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function MatrixQueryPanel({
  matrix,
  query,
  onPatch,
  onClear,
  biosampleTotalFallback,
}: MatrixQueryPanelProps) {
  const matrixId = matrix.matrixId
  const catalog = useFilteringTerms(
    `/matrices/${encodeURIComponent(matrixId)}/filtering_terms`
  )
  const scopeIndex = useMemo(
    () => buildFilterScopeIndex(catalog.terms),
    [catalog.terms]
  )
  const featureLabels = useMemo(() => catalogLabelById(catalog.terms), [catalog.terms])
  const biosampleLabels = useMemo(() => catalogLabelById(catalog.terms), [catalog.terms])
  const featurePlaceholder = lensQueryPlaceholder(
    'feature',
    catalog.terms,
    catalog.resources
  )
  const biosamplePlaceholder = lensQueryPlaceholder(
    'biosample',
    catalog.terms,
    catalog.resources
  )

  const [featureText, setFeatureText] = useState('')
  const [biosampleText, setBiosampleText] = useState('')
  const [featureError, setFeatureError] = useState('')
  const [biosampleError, setBiosampleError] = useState('')
  const [previewFeatures, setPreviewFeatures] = useState<Feature[]>([])

  useEffect(() => {
    const controller = new AbortController()
    listMatrixFeatures(matrixId, 0, 8, {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) setPreviewFeatures(page.results)
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreviewFeatures([])
      })
    return () => controller.abort()
  }, [matrixId])

  const featureExamples = useMemo(() => {
    if (catalog.loading) return { pinned: [], more: [] }
    return matrixHeatmapFeatureExamples(catalog.terms, previewFeatures)
  }, [catalog.loading, catalog.terms, previewFeatures])

  const biosampleExamples = useMemo(() => {
    if (catalog.loading) return { pinned: [], more: [] }
    return matrixHeatmapBiosampleExamples(catalog.terms)
  }, [catalog.loading, catalog.terms])

  function applyFeatureFilter(filter: UiFilter) {
    onPatch((current) => {
      if (filter.kind === 'symbol') {
        if (current.genes.some((gene) => gene.toUpperCase() === filter.value.toUpperCase())) {
          return current
        }
        return { genes: [...current.genes, filter.value] }
      }
      if (
        filter.kind === 'custom' &&
        filter.id.toLowerCase().startsWith('symbol:')
      ) {
        const symbol = filter.id.slice(filter.id.indexOf(':') + 1).trim()
        if (!symbol) return current
        if (current.genes.some((gene) => gene.toUpperCase() === symbol.toUpperCase())) {
          return current
        }
        return { genes: [...current.genes, symbol] }
      }
      if (filter.kind === 'expression') {
        return {
          featureFilters: dedupeFilters([...current.featureFilters, filter]),
        }
      }
      if (
        filter.kind === 'ontology' ||
        filter.kind === 'custom' ||
        filter.kind === 'alphanumeric'
      ) {
        return {
          featureFilters: mergeGeneLensFilters(current.featureFilters, filter),
        }
      }
      return current
    })
  }

  function toggleFeatureFilter(filter: UiFilter) {
    const key = filterKey(filter)
    const active = query.featureFilters.some((item) => filterKey(item) === key)
    if (active) {
      onPatch((current) => ({
        featureFilters: current.featureFilters.filter((item) => filterKey(item) !== key),
      }))
      return
    }
    applyFeatureFilter(filter)
  }

  function applyBiosampleFilter(filter: UiFilter) {
    onPatch((current) => ({
      biosampleFilters: mergeSampleLensFilters(current.biosampleFilters, filter),
    }))
  }

  function applyFeatureToken(raw: string) {
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (!parts.length) return
    const invalid: string[] = []
    let message = ''
    onPatch((current) => {
      let genes = current.genes
      let featureIds = current.featureIds
      let featureFilters = current.featureFilters
      for (const part of parts) {
        const token = interpretFeatureQueryToken(part, catalog.terms, scopeIndex)
        if (!token.ok) {
          invalid.push(part)
          message = token.message
          continue
        }
        if (token.kind === 'gene') {
          if (!genes.some((gene) => gene.toUpperCase() === token.value.toUpperCase())) {
            genes = [...genes, token.value]
          }
        } else if (token.kind === 'featureId') {
          if (!featureIds.includes(token.value)) featureIds = [...featureIds, token.value]
        } else if (token.kind === 'filter') {
          featureFilters = dedupeFilters([...featureFilters, token.filter])
        }
      }
      return { genes, featureIds, featureFilters }
    })
    setFeatureText(invalid.join(', '))
    setFeatureError(message)
  }

  function applyBiosampleToken(raw: string) {
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (!parts.length) return
    const invalid: string[] = []
    let message = ''
    onPatch((current) => {
      let biosampleIds = current.biosampleIds
      let biosampleFilters = current.biosampleFilters
      for (const part of parts) {
        const token = interpretBiosampleQueryToken(part, catalog.terms, scopeIndex)
        if (!token.ok) {
          invalid.push(part)
          message = token.message
          continue
        }
        if (token.kind === 'biosampleId') {
          if (!biosampleIds.includes(token.value)) biosampleIds = [...biosampleIds, token.value]
        } else if (token.kind === 'filter') {
          biosampleFilters = mergeSampleLensFilters(biosampleFilters, token.filter)
        }
      }
      return { biosampleIds, biosampleFilters }
    })
    setBiosampleText(invalid.join(', '))
    setBiosampleError(message)
  }

  function applySuggestion(
    suggestion: { token: string },
    axis: 'feature' | 'biosample'
  ) {
    if (axis === 'feature') {
      setFeatureText('')
      applyFeatureToken(suggestion.token)
    } else {
      setBiosampleText('')
      applyBiosampleToken(suggestion.token)
    }
  }

  const featureChips: QueryChip[] = [
    ...query.featureFilters.map((filter) => {
      const display = filterChipDisplay(filter, featureLabels)
      return {
        key: filterKey(filter),
        label: display.text,
        title: display.tooltip,
      }
    }),
    ...query.featureIds.map((id) => ({
      key: `id:${id}`,
      label: shorten(id),
      title: `Feature ${id}`,
      mono: true,
    })),
    ...query.genes.map((gene) => ({
      key: `gene:${gene}`,
      label: gene,
      title: `Gene ${gene}`,
      mono: true,
    })),
  ]

  const biosampleChips: QueryChip[] = [
    ...query.biosampleIds.map((id) => ({
      key: `id:${id}`,
      label: shorten(id),
      title: `Biosample ${id}`,
      mono: true,
    })),
    ...query.biosampleFilters.map((filter) => {
      const display = filterChipDisplay(filter, biosampleLabels)
      return {
        key: filterKey(filter),
        label: display.text,
        title: display.tooltip,
      }
    }),
  ]

  function removeFeatureChip(key: string) {
    onPatch((current) => {
      if (key.startsWith('gene:')) {
        const gene = key.slice('gene:'.length)
        return { genes: current.genes.filter((item) => item !== gene) }
      }
      if (key.startsWith('id:')) {
        const id = key.slice('id:'.length)
        return { featureIds: current.featureIds.filter((item) => item !== id) }
      }
      return {
        featureFilters: current.featureFilters.filter((filter) => filterKey(filter) !== key),
      }
    })
  }

  function removeBiosampleChip(key: string) {
    onPatch((current) => {
      if (key.startsWith('id:')) {
        const id = key.slice('id:'.length)
        return { biosampleIds: current.biosampleIds.filter((item) => item !== id) }
      }
      return {
        biosampleFilters: current.biosampleFilters.filter((filter) => filterKey(filter) !== key),
      }
    })
  }

  const range = matrix.expressionValueRange
  const hasRange =
    range?.min != null &&
    range?.max != null &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max)
  const featureTokens = featureIdListCsv(query)?.split(',').length ?? 0
  const biosampleTokens = biosampleIdListCsv(query)?.split(',').length ?? 0
  const capped = featureTokens >= 100 || biosampleTokens >= 100
  const featureTermCount = browsableTerms(
    catalog.terms.filter((term) => term.scopes?.includes('genomicFeature') ?? false)
  ).length
  const biosampleTermCount = browsableTerms(
    catalog.terms.filter((term) => term.scopes?.includes('biosample') ?? false)
  ).length

  const dimCount = matrix.dimensions?.biosamples
  const hideBiosampleQuery =
    dimCount != null ? dimCount <= 2 : (biosampleTotalFallback ?? Infinity) <= 2

  const gridClass = hideBiosampleQuery
    ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start'
    : 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start'

  return (
    <div className={gridClass}>
      <div className="min-w-0 space-y-1.5">
        <QueryChipInput
          id="matrix-feature-search-input"
          label="Features"
          chips={featureChips}
          text={featureText}
          placeholder={catalog.loading ? 'Add filter…' : featurePlaceholder}
          error={featureError || catalog.error}
          pinnedExamples={exampleChips(featureExamples.pinned, applyFeatureFilter)}
          moreExamples={exampleChips(featureExamples.more, applyFeatureFilter)}
          suggestions={querySuggestions(catalog.terms, featureText, 'feature')}
          onTextChange={(value) => {
            setFeatureText(value)
            if (featureError) setFeatureError('')
          }}
          onCommit={applyFeatureToken}
          onRemove={removeFeatureChip}
          onSuggestion={(suggestion) => applySuggestion(suggestion, 'feature')}
          onBackspaceEmpty={() => {
            const last = featureChips[featureChips.length - 1]
            if (last) removeFeatureChip(last.key)
          }}
        />
        <MatrixBiotypeFamilyChips
          catalogTerms={catalog.terms}
          activeFilters={query.featureFilters}
          onToggle={toggleFeatureFilter}
          loading={catalog.loading}
        />
        <CatalogBrowsePopover
          label="Browse catalog"
          count={featureTermCount}
          loading={catalog.loading}
        >
          <FilteringTermBrowser
            variant="embedded"
            scope="genomicFeature"
            terms={catalog.terms}
            resources={catalog.resources}
            activeFilters={query.featureFilters}
            onAddFilter={applyFeatureFilter}
            loading={catalog.loading}
            error={catalog.error}
          />
        </CatalogBrowsePopover>
      </div>

      {!hideBiosampleQuery && (
        <div className="min-w-0 space-y-1.5">
          <QueryChipInput
            id="matrix-biosample-filter-input"
            label="Biosamples"
            chips={biosampleChips}
            text={biosampleText}
            placeholder={catalog.loading ? 'Add filter…' : biosamplePlaceholder}
            error={biosampleError || catalog.error}
            pinnedExamples={exampleChips(biosampleExamples.pinned, applyBiosampleFilter)}
            moreExamples={exampleChips(biosampleExamples.more, applyBiosampleFilter)}
            suggestions={querySuggestions(catalog.terms, biosampleText, 'biosample')}
            onTextChange={(value) => {
              setBiosampleText(value)
              if (biosampleError) setBiosampleError('')
            }}
            onCommit={applyBiosampleToken}
            onRemove={removeBiosampleChip}
            onSuggestion={(suggestion) => applySuggestion(suggestion, 'biosample')}
            onBackspaceEmpty={() => {
              const last = biosampleChips[biosampleChips.length - 1]
              if (last) removeBiosampleChip(last.key)
            }}
          />
          <CatalogBrowsePopover
            label="Browse catalog"
            count={biosampleTermCount}
            loading={catalog.loading}
          >
            <FilteringTermBrowser
              variant="embedded"
              scope="biosample"
              terms={catalog.terms}
              resources={catalog.resources}
              activeFilters={query.biosampleFilters}
              onAddFilter={applyBiosampleFilter}
              loading={catalog.loading}
              error={catalog.error}
            />
          </CatalogBrowsePopover>
        </div>
      )}

      <div className="min-w-0 space-y-1.5 lg:border-l lg:border-border lg:pl-3">
        {hasRange && range?.min != null && range.max != null ? (
          <MatrixRangeFilter
            matrixMin={range.min}
            matrixMax={range.max}
            unit={matrix.expressionUnitAndScale?.unit}
            minValue={query.minValue}
            maxValue={query.maxValue}
            onApply={(minValue, maxValue) => onPatch({ minValue, maxValue })}
            trailing={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 shrink-0 px-2.5 text-foreground disabled:opacity-60"
                disabled={!matrixWorkspaceHasConstraints(query)}
                onClick={onClear}
              >
                Clear
              </Button>
            }
          />
        ) : (
          <div className="space-y-1.5">
            <span className="block text-[11px] font-medium text-muted-foreground">Value range</span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <p className="text-[11px] text-muted-foreground">No value range for this matrix.</p>
              <span className="mx-0.5 shrink-0 text-sm text-muted-foreground" aria-hidden>
                |
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 shrink-0 px-2.5 text-foreground disabled:opacity-60"
                disabled={!matrixWorkspaceHasConstraints(query)}
                onClick={onClear}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
        {capped && (
          <p className="text-[10px] text-muted-foreground">
            Gene and id lists are capped at 100 tokens.
          </p>
        )}
      </div>
    </div>
  )
}
