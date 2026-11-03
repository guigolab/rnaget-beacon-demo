'use client'

import { BandCellPopoverContent } from '@/components/genes/band-cell-popover-content'
import { FeatureRowPopoverContent } from '@/components/genes/feature-row-popover-content'
import { MatrixPopoverDetails } from '@/components/genes/matrix-popover-details'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import type { BandCellValue } from '@/lib/expression-band'
import type { ReactNode } from 'react'

export type HeatmapPopoverInspect =
  | { kind: 'feature-row'; featureId: string }
  | { kind: 'matrix-cell'; featureId: string; matrixId: string }
  | { kind: 'matrix-header'; matrixId: string }

type FeatureHeatmapPopoverContentProps = {
  inspect: HeatmapPopoverInspect
  feature: Feature | undefined
  matrix: Matrix | undefined
  band?: BandCellValue
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  matrixContextFeature?: Feature | null
  onNavigate?: () => void
  footer?: ReactNode
}

export function FeatureHeatmapPopoverContent({
  inspect,
  feature,
  matrix,
  band,
  activeFilters,
  onAddFilter,
  matrixContextFeature,
  onNavigate,
  footer,
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

  if (inspect.kind === 'matrix-cell' && feature && matrix && band) {
    return (
      <BandCellPopoverContent
        feature={feature}
        matrix={matrix}
        matrixId={inspect.matrixId}
        band={band}
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
        footer={footer}
      />
    )
  }

  return (
    <p className="px-3 py-2 text-sm text-muted-foreground">Not available.</p>
  )
}
