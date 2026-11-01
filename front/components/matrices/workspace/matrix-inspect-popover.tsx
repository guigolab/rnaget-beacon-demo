'use client'

import { FeatureHeatmapPopoverContent } from '@/components/genes/feature-heatmap-popover-content'
import { MatrixCellPopoverContent } from '@/components/genes/matrix-cell-popover-content'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'
import { Button } from '@/components/ui/button'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Biosample, Feature } from '@/lib/beacon/types'
import type { FeatureMatrixCell } from '@/lib/feature-expression-grid'
import { featureSymbol } from '@/lib/gene-lens'
import { nativeFeatureId } from '@/lib/heatmap-expression'
import { biosampleHeatmapColumnHeader } from '@/lib/sample-lens'

export type MatrixInspect =
  | { kind: 'cell'; featureId: string; biosampleId: string; value: number }
  | { kind: 'feature'; featureId: string }
  | { kind: 'summary'; featureId: string }

export function matrixInspectTriggerId(inspect: MatrixInspect): string {
  if (inspect.kind === 'cell') return `cell:${inspect.featureId}:${inspect.biosampleId}`
  if (inspect.kind === 'summary') return `summary:${inspect.featureId}`
  return `row:${inspect.featureId}`
}

type MatrixInspectPopoverProps = {
  inspect: MatrixInspect
  matrix: Matrix
  features: Feature[]
  biosamples: Biosample[]
  featureFilters: UiFilter[]
  getSummaryCell: (featureId: string) => FeatureMatrixCell | undefined
  onAddFilter: (filter: UiFilter) => void
  onIsolateFeature: (feature: Feature) => void
  onClose: () => void
}

export function MatrixInspectPopover({
  inspect,
  matrix,
  features,
  biosamples,
  featureFilters,
  getSummaryCell,
  onAddFilter,
  onIsolateFeature,
  onClose,
}: MatrixInspectPopoverProps) {
  const { openRecordSheet } = useEntityRecordSheet()
  const feature = features.find((item) => item.id === inspect.featureId)
  if (!feature) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Not available.</p>
  }

  const summaryCell = getSummaryCell(feature.id)
  const isolate = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        onIsolateFeature(feature)
        onClose()
      }}
    >
      Show only this feature
    </Button>
  )

  if (inspect.kind === 'feature') {
    return (
      <FeatureHeatmapPopoverContent
        inspect={{ kind: 'feature-row', featureId: feature.id }}
        feature={feature}
        matrix={matrix}
        activeFilters={featureFilters}
        onAddFilter={onAddFilter}
        onNavigate={onClose}
        footer={<div className="pt-2">{isolate}</div>}
      />
    )
  }

  const sample =
    inspect.kind === 'cell'
      ? biosamples.find((item) => item.id === inspect.biosampleId)
      : undefined
  const header = sample ? biosampleHeatmapColumnHeader(sample, biosamples) : undefined

  return (
    <MatrixCellPopoverContent
      feature={feature}
      matrix={matrix}
      matrixId={matrix.matrixId}
      median={summaryCell?.median}
      summary={summaryCell?.summary}
      showMatrixLink={false}
      selectedSample={
        inspect.kind === 'cell'
          ? {
              biosampleId: inspect.biosampleId,
              label: header?.title ?? inspect.biosampleId,
              value: inspect.value,
            }
          : undefined
      }
      onNavigate={onClose}
      footer={
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              openRecordSheet('feature', feature.id)
              onClose()
            }}
          >
            Open feature record
          </Button>
          {inspect.kind === 'cell' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                openRecordSheet('biosample', inspect.biosampleId)
                onClose()
              }}
            >
              Open biosample record
            </Button>
          )}
          {isolate}
        </div>
      }
    />
  )
}

export function isolateFeaturePatch(feature: Feature): {
  genes: string[]
  featureIds: string[]
  featureFilters: UiFilter[]
} {
  const symbol = featureSymbol(feature)
  if (symbol) {
    return { genes: [symbol], featureIds: [], featureFilters: [] }
  }
  return { genes: [], featureIds: [nativeFeatureId(feature)], featureFilters: [] }
}
