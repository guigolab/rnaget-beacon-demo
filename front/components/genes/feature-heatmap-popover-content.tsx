'use client'

import { FeatureRowPopoverContent } from '@/components/genes/feature-row-popover-content'
import { MatrixCellPopoverContent } from '@/components/genes/matrix-cell-popover-content'
import { MatrixPopoverDetails } from '@/components/genes/matrix-popover-details'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'

export type HeatmapPopoverInspect =
  | { kind: 'feature-row'; featureId: string }
  | { kind: 'matrix-cell'; featureId: string; matrixId: string }
  | { kind: 'matrix-header'; matrixId: string }

type FeatureHeatmapPopoverContentProps = {
  inspect: HeatmapPopoverInspect
  feature: Feature | undefined
  matrix: Matrix | undefined
  median?: number
  summary?: ExpressionSummary
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  matrixContextFeature?: Feature | null
  onNavigate?: () => void
}

export function FeatureHeatmapPopoverContent({
  inspect,
  feature,
  matrix,
  median,
  summary,
  activeFilters,
  onAddFilter,
  matrixContextFeature,
  onNavigate,
}: FeatureHeatmapPopoverContentProps) {
  if (inspect.kind === 'matrix-header' && matrix) {
    return (
      <MatrixPopoverDetails
        matrix={matrix}
        feature={matrixContextFeature}
        onNavigate={onNavigate}
      />
    )
  }

  if (inspect.kind === 'matrix-cell' && feature && matrix) {
    return (
      <MatrixCellPopoverContent
        feature={feature}
        matrix={matrix}
        matrixId={inspect.matrixId}
        median={median}
        summary={summary}
        onNavigate={onNavigate}
      />
    )
  }

  if (inspect.kind === 'feature-row' && feature) {
    return (
      <FeatureRowPopoverContent
        feature={feature}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <p className="px-3 py-2 text-sm text-muted-foreground">Not available.</p>
  )
}
