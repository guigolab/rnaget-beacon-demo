'use client'

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

type MatrixQueryPanelProps = {
  matrix: Matrix
  query: MatrixWorkspaceQuery
  onPatch: (update: MatrixQueryUpdate) => void
  onClear: () => void
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
  const [exprField, setExprField] = useState<'expression.median' | 'expression.value'>(
    'expression.median'
  )
  const [exprValue, setExprValue] = useState('')
  const [exprError, setExprError] = useState('')

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
    if (catalog.loading) return []
    return matrixHeatmapFeatureExamples(catalog.terms, previewFeatures)
  }, [catalog.loading, catalog.terms, previewFeatures])

  const biosampleExamples = useMemo(() => {
    if (catalog.loading) return []
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

  const expressionChips: QueryChip[] = query.expressionFilters.map((filter) => {
    const display = filterChipDisplay(filter, featureLabels)
    return {
      key: filterKey(filter),
      label: display.text,
      title: display.tooltip,
    }
  })

  function applyExpressionThreshold() {
    const trimmed = exprValue.trim()
    if (!trimmed) {
      setExprError('Enter a number.')
      return
    }
    const number = Number(trimmed)
    if (!Number.isFinite(number)) {
      setExprError('Enter a valid number.')
      return
    }
    const filter: UiFilter = {
      kind: 'expression',
      id: exprField,
      operator: '>=',
      value: String(number),
      label: `${exprField} >= ${number}`,
    }
    setExprError('')
    setExprValue('')
    if (exprField === 'expression.value') {
      onPatch((current) => ({
        expressionFilters: dedupeFilters([...current.expressionFilters, filter]),
      }))
      return
    }
    onPatch((current) => ({
      featureFilters: dedupeFilters([...current.featureFilters, filter]),
    }))
  }

  function removeExpressionChip(key: string) {
    onPatch((current) => ({
      expressionFilters: current.expressionFilters.filter(
        (filter) => filterKey(filter) !== key
      ),
    }))
  }

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

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
      <div className="min-w-0 space-y-1.5">
        <QueryChipInput
          id="matrix-feature-search-input"
          label="Features"
          chips={featureChips}
          text={featureText}
          placeholder={catalog.loading ? 'Add filter…' : featurePlaceholder}
          error={featureError || catalog.error}
          examples={featureExamples.map((example) => ({
            label: example.label,
            onSelect: () => applyFeatureFilter(example.filter),
          }))}
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
        <TermBrowse count={featureTermCount} loading={catalog.loading}>
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
        </TermBrowse>
      </div>

      <div className="min-w-0 space-y-1.5">
        <QueryChipInput
          id="matrix-biosample-filter-input"
          label="Biosamples"
          chips={biosampleChips}
          text={biosampleText}
          placeholder={catalog.loading ? 'Add filter…' : biosamplePlaceholder}
          error={biosampleError || catalog.error}
          examples={biosampleExamples.map((example) => ({
            label: example.label,
            onSelect: () => applyBiosampleFilter(example.filter),
          }))}
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
        <TermBrowse count={biosampleTermCount} loading={catalog.loading}>
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
        </TermBrowse>
      </div>

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
        <div className="space-y-1.5">
          <span className="block text-[11px] font-medium text-muted-foreground">
            Expression threshold
          </span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <select
              aria-label="Expression field"
              value={exprField}
              onChange={(event) =>
                setExprField(event.target.value as 'expression.median' | 'expression.value')
              }
              className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="expression.median">expression.median</option>
              <option value="expression.value">expression.value</option>
            </select>
            <span className="font-mono text-xs text-muted-foreground" aria-hidden>
              &gt;=
            </span>
            <input
              aria-label="Expression threshold value"
              value={exprValue}
              inputMode="decimal"
              placeholder="e.g. 10"
              onChange={(event) => {
                setExprValue(event.target.value)
                if (exprError) setExprError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyExpressionThreshold()
                }
              }}
              className="h-9 w-[4.75rem] shrink-0 rounded-md border border-border bg-background px-2 text-right font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 px-2.5"
              onClick={applyExpressionThreshold}
            >
              Add
            </Button>
          </div>
          {expressionChips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {expressionChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted"
                  title={chip.title}
                  onClick={() => removeExpressionChip(chip.key)}
                >
                  {chip.label} ×
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] leading-snug text-muted-foreground">
            Median filters feature rows; value filters cells. Range above is minValue/maxValue
            sugar.
          </p>
          {exprError && (
            <p className="text-[11px] text-destructive" role="status">
              {exprError}
            </p>
          )}
        </div>
        {capped && (
          <p className="text-[10px] text-muted-foreground">
            Gene and id lists are capped at 100 tokens.
          </p>
        )}
      </div>
    </div>
  )
}
