'use client'

import { FeatureAnnotationChips } from '@/components/genes/feature-annotation-chips'
import { DetailScalarGrid } from '@/components/shared/detail/detail-scalar-grid'
import { DetailSection } from '@/components/shared/detail/detail-section'
import { featureScalarFacts } from '@/lib/beacon/facts'
import type { Feature, FilteringResource, UiFilter } from '@/lib/beacon/types'
import { featureQueryChips } from '@/lib/feature-query-chips'

type FeatureDetailSectionsProps = {
  feature: Feature
  resources?: FilteringResource[]
  activeFilters?: UiFilter[]
  onAddFilter?: (filter: UiFilter) => void
  readOnly?: boolean
}

function AnnotationBlock({
  title,
  kinds,
  feature,
  activeFilters,
  onAddFilter,
  readOnly,
}: {
  title: string
  kinds: ('alias' | 'xref' | 'ontology')[]
  feature: Feature
  activeFilters: UiFilter[]
  onAddFilter?: (filter: UiFilter) => void
  readOnly?: boolean
}) {
  const has = featureQueryChips(feature).some((c) => kinds.includes(c.kind))
  if (!has) return null

  return (
    <DetailSection title={title}>
      <FeatureAnnotationChips
        feature={feature}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter ?? (() => {})}
        kinds={kinds}
        readOnly={readOnly}
      />
    </DetailSection>
  )
}

export function FeatureDetailSections({
  feature,
  resources = [],
  activeFilters = [],
  onAddFilter,
  readOnly = false,
}: FeatureDetailSectionsProps) {
  const scalarRows = featureScalarFacts(feature, resources).map((f) => ({
    label: f.label,
    value: f.value,
    links: f.links,
  }))

  return (
    <div className="space-y-2.5">
      <AnnotationBlock
        title="Aliases"
        kinds={['alias']}
        feature={feature}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
        readOnly={readOnly}
      />
      <AnnotationBlock
        title="Cross references"
        kinds={['xref']}
        feature={feature}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
        readOnly={readOnly}
      />
      <AnnotationBlock
        title="Ontologies"
        kinds={['ontology']}
        feature={feature}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
        readOnly={readOnly}
      />
      <DetailSection title="Identifiers & location">
        <DetailScalarGrid rows={scalarRows} />
      </DetailSection>
    </div>
  )
}
