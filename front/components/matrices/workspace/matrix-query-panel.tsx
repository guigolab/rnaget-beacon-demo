'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FilteringTermBrowser } from '@/components/shared/filtering-term-browser'
import { Button } from '@/components/ui/button'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { MatrixQueryUpdate } from '@/hooks/use-matrix-query-state'
import {
  dedupeFilters,
  filterKey,
  buildFilterScopeIndex,
  mergeFilterScopeIndexes,
} from '@/lib/beacon'
import { listMatrixFeatures } from '@/lib/beacon/client'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import { catalogLabelById, filterChipDisplay } from '@/lib/gene-filter-labels'
import { browsableTerms, lensQueryPlaceholder } from '@/lib/lens-catalog'
import {
  matrixHeatmapBiosampleExamples,
  matrixHeatmapFeatureExamples,
  matrixHeatmapFilteringTermsPath,
} from '@/lib/matrix-workspace'
import {
  biosampleIdListCsv,
  featureIdListCsv,
  interpretBiosampleQueryToken,
  interpretFeatureQueryToken,
  matrixWorkspaceHasConstraints,
  querySuggestions,
  type MatrixWorkspaceQuery,
  type QuerySuggestion,
} from '@/lib/matrix-workspace-query'
import { mergeSampleLensFilters } from '@/lib/sample-lens'
import { MatrixRangeFilter } from './matrix-range-filter'
import { QueryChipInput, type QueryChip } from './query-chip-input'

function shorten(id: string) {
  return id.length > 22 ? `${id.slice(0, 20)}…` : id
}

type AxisCount = {
  loading: boolean
  total: number | null
}

type MatrixQueryPanelProps = {
  matrix: Matrix
  query: MatrixWorkspaceQuery
  onPatch: (update: MatrixQueryUpdate) => void
  onClear: () => void
  featureCount: AxisCount
  biosampleCount: AxisCount
}

function AxisTotal({ noun, count }: { noun: string; count: AxisCount }) {
  if (count.loading) {
    return <p className="text-[11px] text-muted-foreground">Loading {noun}…</p>
  }
  if (count.total == null) return null
  const label = count.total === 1 ? noun.replace(/s$/, '') : noun
  return (
    <p className="text-[11px] tabular-nums text-muted-foreground">
      {count.total.toLocaleString()} {label}
    </p>
  )
}

function TermBrowse({
  count,
  loading,
  children,
}: {
  count: number
  loading: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (!loading && count === 0) return null
  return (
    <div>
      <button
        type="button"
        className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide terms' : `Browse terms${loading ? '' : ` (${count.toLocaleString()})`}`}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

export function MatrixQueryPanel({
  matrix,
  query,
  onPatch,
  onClear,
  featureCount,
  biosampleCount,
}: MatrixQueryPanelProps) {
  const matrixId = matrix.matrixId
  const featurePath = matrixHeatmapFilteringTermsPath(matrixId, 'features')
  const biosamplePath = matrixHeatmapFilteringTermsPath(matrixId, 'biosamples')
  const featureTerms = useFilteringTerms(featurePath)
  const biosampleTerms = useFilteringTerms(biosamplePath)
  const scopeIndex = useMemo(
    () =>
      mergeFilterScopeIndexes(
        buildFilterScopeIndex(featureTerms.terms),
        buildFilterScopeIndex(biosampleTerms.terms)
      ),
    [featureTerms.terms, biosampleTerms.terms]
  )
  const featureLabels = useMemo(() => catalogLabelById(featureTerms.terms), [featureTerms.terms])
  const biosampleLabels = useMemo(
    () => catalogLabelById(biosampleTerms.terms),
    [biosampleTerms.terms]
  )
  const featurePlaceholder = lensQueryPlaceholder(
    'feature',
    featureTerms.terms,
    featureTerms.resources
  )
  const biosamplePlaceholder = lensQueryPlaceholder(
    'biosample',
    biosampleTerms.terms,
    biosampleTerms.resources
  )

  const [featureText, setFeatureText] = useState('')
  const [biosampleText, setBiosampleText] = useState('')
  const [featureError, setFeatureError] = useState('')
  const [biosampleError, setBiosampleError] = useState('')
  const [previewFeatures, setPreviewFeatures] = useState<Feature[]>([])

  useEffect(() => {
    const controller = new AbortController()
    listMatrixFeatures(matrixId, 0, 8, {
      sort: 'expression.max',
      order: 'desc',
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
    if (featureTerms.loading) return []
    return matrixHeatmapFeatureExamples(featureTerms.terms, previewFeatures)
  }, [featureTerms.loading, featureTerms.terms, previewFeatures])

  const biosampleExamples = useMemo(() => {
    if (biosampleTerms.loading) return []
    return matrixHeatmapBiosampleExamples(biosampleTerms.terms)
  }, [biosampleTerms.loading, biosampleTerms.terms])

  function applyFeatureFilter(filter: UiFilter) {
    onPatch((current) => {
      if (filter.kind === 'symbol') {
        if (current.genes.some((gene) => gene.toUpperCase() === filter.value.toUpperCase())) {
          return current
        }
        return { genes: [...current.genes, filter.value] }
      }
      if (filter.kind === 'ontology' || filter.kind === 'custom') {
        return { featureFilters: dedupeFilters([...current.featureFilters, filter]) }
      }
      return current
    })
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
        const token = interpretFeatureQueryToken(part, featureTerms.terms, scopeIndex)
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
        const token = interpretBiosampleQueryToken(part, biosampleTerms.terms, scopeIndex)
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

  function applySuggestion(suggestion: QuerySuggestion, axis: 'feature' | 'biosample') {
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
  const featureTermCount = browsableTerms(featureTerms.terms).length
  const biosampleTermCount = browsableTerms(biosampleTerms.terms).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Filters apply to this matrix only.</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!matrixWorkspaceHasConstraints(query)}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>

      <div className="space-y-2">
        <QueryChipInput
          id="matrix-feature-search-input"
          label="Features"
          chips={featureChips}
          text={featureText}
          placeholder={featureTerms.loading ? 'Add filter…' : featurePlaceholder}
          error={featureError || featureTerms.error}
          examples={featureExamples.map((example) => ({
            label: example.label,
            onSelect: () => applyFeatureFilter(example.filter),
          }))}
          suggestions={querySuggestions(featureTerms.terms, featureText, 'feature')}
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
        <AxisTotal noun="features" count={featureCount} />
        <TermBrowse count={featureTermCount} loading={featureTerms.loading}>
          <FilteringTermBrowser
            variant="embedded"
            scope="genomicFeature"
            terms={featureTerms.terms}
            resources={featureTerms.resources}
            activeFilters={query.featureFilters}
            onAddFilter={applyFeatureFilter}
            loading={featureTerms.loading}
            error={featureTerms.error}
          />
        </TermBrowse>
      </div>

      <div className="space-y-2">
        <QueryChipInput
          id="matrix-biosample-filter-input"
          label="Biosamples"
          chips={biosampleChips}
          text={biosampleText}
          placeholder={biosampleTerms.loading ? 'Add filter…' : biosamplePlaceholder}
          error={biosampleError || biosampleTerms.error}
          examples={biosampleExamples.map((example) => ({
            label: example.label,
            onSelect: () => applyBiosampleFilter(example.filter),
          }))}
          suggestions={querySuggestions(biosampleTerms.terms, biosampleText, 'biosample')}
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
        <AxisTotal noun="biosamples" count={biosampleCount} />
        <TermBrowse count={biosampleTermCount} loading={biosampleTerms.loading}>
          <FilteringTermBrowser
            variant="embedded"
            scope="biosample"
            terms={biosampleTerms.terms}
            resources={biosampleTerms.resources}
            activeFilters={query.biosampleFilters}
            onAddFilter={applyBiosampleFilter}
            loading={biosampleTerms.loading}
            error={biosampleTerms.error}
          />
        </TermBrowse>
      </div>

      {capped && (
        <p className="text-[11px] text-muted-foreground">
          Gene and id lists are capped at 100 tokens.
        </p>
      )}

      {hasRange && range?.min != null && range.max != null && (
        <div className="border-t border-border pt-3">
          <MatrixRangeFilter
            matrixMin={range.min}
            matrixMax={range.max}
            unit={matrix.expressionUnitAndScale?.unit}
            minValue={query.minValue}
            maxValue={query.maxValue}
            onApply={(minValue, maxValue) => onPatch({ minValue, maxValue })}
          />
        </div>
      )}
    </div>
  )
}
