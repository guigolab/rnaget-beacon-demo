'use client'

import { FeatureHeatmapPopoverContent } from '@/components/genes/feature-heatmap-popover-content'
import { MatrixCellPopoverContent } from '@/components/genes/matrix-cell-popover-content'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'
import { Button } from '@/components/ui/button'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Biosample, Feature } from '@/lib/beacon/types'
import { featureSymbol } from '@/lib/gene-lens'
import { nativeFeatureId } from '@/lib/heatmap-expression'
import { biosampleHeatmapColumnHeader } from '@/lib/sample-lens'

export type MatrixInspect =
  | { kind: 'cell'; featureId: string; biosampleId: string; value: number }
  | { kind: 'feature'; featureId: string }

export function matrixInspectTriggerId(inspect: MatrixInspect): string {
  if (inspect.kind === 'cell') return `cell:${inspect.featureId}:${inspect.biosampleId}`
  return `row:${inspect.featureId}`
}

type MatrixInspectPopoverProps = {
  inspect: MatrixInspect
  matrix: Matrix
  features: Feature[]
  biosamples: Biosample[]
  featureFilters: UiFilter[]
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
  onAddFilter,
  onIsolateFeature,
  onClose,
}: MatrixInspectPopoverProps) {
  const { openRecordSheet } = useEntityRecordSheet()

  const feature = features.find((item) => item.id === inspect.featureId)
  if (!feature) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Not available.</p>
  }

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

  const sample = biosamples.find((item) => item.id === inspect.biosampleId)
  const header = sample ? biosampleHeatmapColumnHeader(sample, biosamples) : undefined

  return (
    <MatrixCellPopoverContent
      feature={feature}
      matrix={matrix}
      matrixId={matrix.matrixId}
      showMatrixLink={false}
      selectedSample={{
        biosampleId: inspect.biosampleId,
        label: header?.title ?? inspect.biosampleId,
        value: inspect.value,
      }}
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
