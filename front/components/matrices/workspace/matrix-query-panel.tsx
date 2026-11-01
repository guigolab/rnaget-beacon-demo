'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMatrixAxisFilteringTerms } from '@/hooks/use-matrix-axis-filtering-terms'
import type { MatrixQueryUpdate } from '@/hooks/use-matrix-query-state'
import { dedupeFilters, filterKey, buildFilterScopeIndex, mergeFilterScopeIndexes } from '@/lib/beacon'
import { listMatrixFeatures } from '@/lib/beacon/client'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import { catalogLabelById, filterChipDisplay } from '@/lib/gene-filter-labels'
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

export function MatrixQueryPanel({ matrix, query, onPatch, onClear }: MatrixQueryPanelProps) {
  const matrixId = matrix.matrixId
  const featureTerms = useMatrixAxisFilteringTerms(matrixId, 'features')
  const biosampleTerms = useMatrixAxisFilteringTerms(matrixId, 'biosamples')
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

  const [featureText, setFeatureText] = useState('')
  const [biosampleText, setBiosampleText] = useState('')
  const [featureError, setFeatureError] = useState('')
  const [biosampleError, setBiosampleError] = useState('')
  const [previewFeatures, setPreviewFeatures] = useState<Feature[]>([])

  useEffect(() => {
    const controller = new AbortController()
    listMatrixFeatures(
      matrixId,
      0,
      8,
      { sort: 'expression.max', order: 'desc', signal: controller.signal }
    )
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
    return matrixHeatmapFeatureExamples(featureTerms.terms, previewFeatures).slice(0, 4)
  }, [featureTerms.loading, featureTerms.terms, previewFeatures])

  const biosampleExamples = useMemo(() => {
    if (biosampleTerms.loading || !biosampleTerms.terms.length) return []
    return matrixHeatmapBiosampleExamples(biosampleTerms.terms).slice(0, 4)
  }, [biosampleTerms.loading, biosampleTerms.terms])

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
  const capped = (featureIdListCsv(query)?.split(',').length ?? 0) >= 100 || (biosampleIdListCsv(query)?.split(',').length ?? 0) >= 100

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

      <QueryChipInput
        id="matrix-feature-search-input"
        label="Features"
        chips={featureChips}
        text={featureText}
        placeholder="TP53, BRCA1, SO:…, GO:…"
        error={featureError || featureTerms.error}
        examples={featureExamples.map((example) => ({
          label: example.label,
          onSelect: () => {
            if (example.filter.kind === 'symbol') applyFeatureToken(example.filter.value)
            else if (example.filter.kind === 'ontology' || example.filter.kind === 'custom') {
              applyFeatureToken(example.filter.id)
            }
          },
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

      <QueryChipInput
        id="matrix-biosample-filter-input"
        label="Biosamples"
        chips={biosampleChips}
        text={biosampleText}
        placeholder="Biosample id, tissue, UBERON:…, female"
        error={biosampleError || biosampleTerms.error}
        examples={biosampleExamples.map((example) => ({
          label: example.label,
          onSelect: () => {
            const filter = example.filter
            if (filter.kind === 'sex' || filter.kind === 'alphanumeric') {
              applyBiosampleToken(filter.value)
            } else if (filter.kind === 'ontology' || filter.kind === 'custom') {
              applyBiosampleToken(filter.id)
            }
          },
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
