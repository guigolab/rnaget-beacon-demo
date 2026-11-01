'use client'

import { FeatureDetailSections } from '@/components/features/feature-detail-sections'
import { DetailHeaderIconLink } from '@/components/shared/detail/detail-header-icon-link'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'
import type { UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import type { ReactNode } from 'react'
import {
  featureAnnotationResource,
  featureDisplayLabel,
  matrixCountForFeature,
} from '@/lib/gene-lens'

type FeatureRowPopoverContentProps = {
  feature: Feature
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  onNavigate?: () => void
  footer?: ReactNode
}

export function FeatureRowPopoverContent({
  feature,
  activeFilters,
  onAddFilter,
  onNavigate,
  footer,
}: FeatureRowPopoverContentProps) {
  const { openRecordSheet } = useEntityRecordSheet()
  const gf = feature.genomicFeature
  const typeLabel = gf?.featureType?.label ?? gf?.featureType?.id
  const meta = [
    featureAnnotationResource(feature) ?? '—',
    `${matrixCountForFeature(feature)} matrices`,
    typeLabel,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="text-popover-foreground">
      <DetailSurfaceHeader
        density="popover"
        title={featureDisplayLabel(feature)}
        subtitle={feature.id}
        meta={meta}
        actions={
          <DetailHeaderIconLink
            label="Open feature record"
            onClick={() => {
              openRecordSheet('feature', feature.id)
              onNavigate?.()
            }}
          />
        }
      />
      <DetailScrollBody density="popover">
        <FeatureDetailSections
          feature={feature}
          activeFilters={activeFilters}
          onAddFilter={onAddFilter}
        />
        {footer}
      </DetailScrollBody>
    </div>
  )
}
