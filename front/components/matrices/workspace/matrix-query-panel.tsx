'use client'

import { Popover } from '@base-ui/react/popover'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FilterTypeLegend } from '@/components/shared/filter-type-legend'
import { FilterChipButton } from '@/components/shared/filter-chip-button'
import { Button } from '@/components/ui/button'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { MatrixQueryUpdate } from '@/hooks/use-matrix-query-state'
import { dedupeFilters, filterKey, buildFilterScopeIndex } from '@/lib/beacon'
import { listMatrixFeatures } from '@/lib/beacon/client'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import { catalogLabelById, filterChipDisplay } from '@/lib/gene-filter-labels'
import {
  filterTermTypeOf,
  filterTypeChipStyle,
  type FilterTermType,
} from '@/lib/filter-type-theme'
import { formatHeatmapValue } from '@/lib/heatmap-expression'
import { lensQueryPlaceholder } from '@/lib/lens-catalog'
import { matrixFilterGroups } from '@/lib/matrix-filter-groups'
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
import { FilterGroupPopover } from './filter-group-popover'
import { MatrixRangeFilter } from './matrix-range-filter'
import { QueryChipInput, type QueryExampleChip } from './query-chip-input'

type AppliedChip = {
  key: string
  label: string
  title?: string
  mono?: boolean
  type: FilterTermType
}

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

function AppliedRow({
  label,
  chips,
  onRemove,
}: {
  label: string
  chips: AppliedChip[]
  onRemove: (key: string) => void
}) {
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      {chips.map((chip) => (
        <FilterChipButton
          key={chip.key}
          label={chip.label}
          title={chip.title}
          mono={chip.mono}
          style={filterTypeChipStyle(chip.type)}
          onRemove={() => onRemove(chip.key)}
        />
      ))}
    </div>
  )
}

export function MatrixQueryPanel({
  matrix,
  query,
  onPatch,
  onClear,
  biosampleTotalFallback,
}: MatrixQueryPanelProps) {
  const matrixId = matrix.id
  const catalog = useFilteringTerms('/filtering_terms')
  const scopeIndex = useMemo(
    () => buildFilterScopeIndex(catalog.terms),
    [catalog.terms]
  )
  const labels = useMemo(() => catalogLabelById(catalog.terms), [catalog.terms])
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
  const featureGroups = useMemo(
    () => matrixFilterGroups('feature', catalog.terms, catalog.resources),
    [catalog.terms, catalog.resources]
  )
  const biosampleGroups = useMemo(
    () => matrixFilterGroups('biosample', catalog.terms, catalog.resources),
    [catalog.terms, catalog.resources]
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
      if (filter.kind === 'expression') {
        return {
          featureFilters: dedupeFilters([...current.featureFilters, filter]),
        }
      }
      if (filter.kind === 'ontology' || filter.kind === 'alphanumeric') {
        return {
          featureFilters: mergeGeneLensFilters(current.featureFilters, filter),
        }
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

  const featureChips: AppliedChip[] = [
    ...query.featureFilters.map((filter) => {
      const display = filterChipDisplay(filter, labels)
      return {
        key: filterKey(filter),
        label: display.text,
        title: display.tooltip,
        type: filterTermTypeOf(filter),
      }
    }),
    ...query.featureIds.map((id) => ({
      key: `id:${id}`,
      label: shorten(id),
      title: `Feature ${id}`,
      mono: true,
      type: 'alphanumeric' as const,
    })),
    ...query.genes.map((gene) => ({
      key: `gene:${gene}`,
      label: gene,
      title: `Gene ${gene}`,
      mono: true,
      type: 'alphanumeric' as const,
    })),
  ]

  const biosampleChips: AppliedChip[] = [
    ...query.biosampleIds.map((id) => ({
      key: `id:${id}`,
      label: shorten(id),
      title: `Biosample ${id}`,
      mono: true,
      type: 'alphanumeric' as const,
    })),
    ...query.biosampleFilters.map((filter) => {
      const display = filterChipDisplay(filter, labels)
      return {
        key: filterKey(filter),
        label: display.text,
        title: display.tooltip,
        type: filterTermTypeOf(filter),
      }
    }),
  ]

  const range = matrix.expressionValueRange
  const hasRange =
    range?.min != null &&
    range?.max != null &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max)
  const unit = matrix.expressionUnitAndScale?.unit
  const rangeActive = query.minValue != null || query.maxValue != null
  const valueChips: AppliedChip[] =
    rangeActive && hasRange && range?.min != null && range.max != null
      ? [
          {
            key: 'range',
            label: `${formatHeatmapValue(query.minValue ?? range.min)} – ${formatHeatmapValue(query.maxValue ?? range.max)}${unit ? ` ${unit}` : ''}`,
            title: 'Value range (click to remove)',
            mono: true,
            type: 'alphanumeric',
          },
        ]
      : []

  const featureTokens = featureIdListCsv(query)?.split(',').length ?? 0
  const biosampleTokens = biosampleIdListCsv(query)?.split(',').length ?? 0
  const featureCapped = featureTokens >= 100
  const biosampleCapped = biosampleTokens >= 100
  const activeCount = featureChips.length + biosampleChips.length + valueChips.length

  const dimCount = matrix.dimensions?.biosamples
  const hideBiosampleQuery =
    dimCount != null ? dimCount <= 2 : (biosampleTotalFallback ?? Infinity) <= 2

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Filters</h2>
        {activeCount > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
            {activeCount} active
          </span>
        )}
        <FilterTypeLegend className="ml-1 hidden sm:flex" />
        <div className="ml-auto flex items-center gap-2">
          {hasRange && range?.min != null && range.max != null && (
            <Popover.Root>
              <Popover.Trigger
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:border-foreground/30"
              >
                Value range
                <ChevronDown className="size-3" aria-hidden />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6} align="end" className="z-[200]">
                  <Popover.Popup className="z-[200] w-[min(100vw-2rem,22rem)] rounded-lg border border-border bg-popover p-3 shadow-lg outline-none">
                    <MatrixRangeFilter
                      matrixMin={range.min}
                      matrixMax={range.max}
                      unit={unit}
                      minValue={query.minValue}
                      maxValue={query.maxValue}
                      onApply={(minValue, maxValue) => onPatch({ minValue, maxValue })}
                    />
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-foreground disabled:opacity-60"
            disabled={!matrixWorkspaceHasConstraints(query)}
            onClick={onClear}
          >
            Clear all
          </Button>
        </div>
      </div>

      <div
        className={
          hideBiosampleQuery
            ? 'grid gap-3'
            : 'grid gap-3 lg:grid-cols-2 lg:items-start'
        }
      >
        <div className="min-w-0">
          <QueryChipInput
            id="matrix-feature-search-input"
            label="Features"
            hasChips={featureChips.length > 0}
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
            onSuggestion={(suggestion) => applySuggestion(suggestion, 'feature')}
            onBackspaceEmpty={() => {
              const last = featureChips[featureChips.length - 1]
              if (last) removeFeatureChip(last.key)
            }}
          >
            {featureGroups.map((group) => (
              <FilterGroupPopover
                key={group.key}
                group={group}
                activeFilters={query.featureFilters}
                onAdd={applyFeatureFilter}
              />
            ))}
          </QueryChipInput>
          {featureCapped && (
            <p className="mt-1 text-xs text-muted-foreground">
              Gene and id lists are capped at 100 tokens.
            </p>
          )}
        </div>

        {!hideBiosampleQuery && (
          <div className="min-w-0">
            <QueryChipInput
              id="matrix-biosample-filter-input"
              label="Biosamples"
              hasChips={biosampleChips.length > 0}
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
              onSuggestion={(suggestion) => applySuggestion(suggestion, 'biosample')}
              onBackspaceEmpty={() => {
                const last = biosampleChips[biosampleChips.length - 1]
                if (last) removeBiosampleChip(last.key)
              }}
            >
              {biosampleGroups.map((group) => (
                <FilterGroupPopover
                  key={group.key}
                  group={group}
                  activeFilters={query.biosampleFilters}
                  onAdd={applyBiosampleFilter}
                />
              ))}
            </QueryChipInput>
            {biosampleCapped && (
              <p className="mt-1 text-xs text-muted-foreground">
                Gene and id lists are capped at 100 tokens.
              </p>
            )}
          </div>
        )}
      </div>

      {activeCount > 0 && (
        <div className="space-y-1.5 border-t border-border pt-2.5">
          <AppliedRow label="Features" chips={featureChips} onRemove={removeFeatureChip} />
          <AppliedRow label="Biosamples" chips={biosampleChips} onRemove={removeBiosampleChip} />
          <AppliedRow
            label="Value"
            chips={valueChips}
            onRemove={() => onPatch({ minValue: undefined, maxValue: undefined })}
          />
        </div>
      )}
    </div>
  )
}
