'use client'

import { Button } from '@/components/ui/button'
import { MatrixPopoverDetails } from '@/components/genes/matrix-popover-details'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import type { Matrix, UiFilter } from '@/lib/beacon'
import type { OntologyGridCell, OntologyRow } from '@/lib/biosample-ontology-grid'

export type OntologyHeatmapInspect =
  | { kind: 'ontology-row'; ontologyId: string }
  | { kind: 'matrix-header'; matrixId: string }
  | { kind: 'matrix-cell'; ontologyId: string; matrixId: string }

type BiosampleOntologyHeatmapPopoverProps = {
  inspect: OntologyHeatmapInspect
  row: OntologyRow | undefined
  matrix: Matrix | undefined
  cell: OntologyGridCell | undefined
  onBrowseRecords?: (filter: UiFilter, matrixId: string) => void
  onAddFilter?: (filter: UiFilter) => void
  onNavigate?: () => void
}

export function BiosampleOntologyHeatmapPopover({
  inspect,
  row,
  matrix,
  cell,
  onBrowseRecords,
  onAddFilter,
  onNavigate,
}: BiosampleOntologyHeatmapPopoverProps) {
  if (inspect.kind === 'matrix-header' && matrix) {
    return <MatrixPopoverDetails matrix={matrix} onNavigate={onNavigate} />
  }

  if (inspect.kind === 'ontology-row' && row) {
    const filter: UiFilter = {
      kind: 'ontology',
      id: row.id,
      label: row.label,
    }
    return (
      <div className="text-popover-foreground text-xs">
        <DetailSurfaceHeader
          density="popover"
          title={row.label}
          subtitle={row.id}
        />
        <DetailScrollBody className="space-y-3">
          {row.type && <MetaBadge>{row.type}</MetaBadge>}
          <p className="text-muted-foreground">
            Tissue or cell ontology used to collapse biosamples across matrices.
          </p>
          {onAddFilter && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onAddFilter(filter)
                onNavigate?.()
              }}
            >
              Filter by this ontology
            </Button>
          )}
        </DetailScrollBody>
      </div>
    )
  }

  if (inspect.kind === 'matrix-cell' && row) {
    const filter: UiFilter = {
      kind: 'ontology',
      id: row.id,
      label: row.label,
    }
    const countLabel =
      cell?.state === 'present' && cell.count != null
        ? cell.count.toLocaleString()
        : cell?.state === 'absent'
          ? '0'
          : '…'
    return (
      <div className="text-popover-foreground text-xs">
        <DetailSurfaceHeader
          density="popover"
          title={row.label}
          subtitle={matrix?.name ?? inspect.matrixId}
        />
        <DetailScrollBody className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <MetaBadge>{row.id}</MetaBadge>
            <MetaBadge>
              {cell?.state === 'present'
                ? `${countLabel} biosamples`
                : cell?.state === 'absent'
                  ? 'Not present'
                  : 'Loading count…'}
            </MetaBadge>
          </div>
          {onBrowseRecords && cell?.state === 'present' && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onBrowseRecords(filter, inspect.matrixId)
                onNavigate?.()
              }}
            >
              Browse matching biosamples
            </Button>
          )}
        </DetailScrollBody>
      </div>
    )
  }

  return (
    <p className="px-3 py-2 text-sm text-muted-foreground">Not available.</p>
  )
}
