'use client'

import { FeatureAnnotationChips } from '@/components/genes/feature-annotation-chips'
import { EntityRecordLink } from '@/components/shared/entity-record-link'
import type { UiFilter } from '@/lib/beacon'
import type { Feature } from '@/lib/beacon/types'
import {
  featureAnnotationResource,
  featureDisplayLabel,
  matrixCountForFeature,
} from '@/lib/gene-lens'
import { featureQueryChips } from '@/lib/feature-query-chips'

type FeatureRowPopoverContentProps = {
  feature: Feature
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  onNavigate?: () => void
}

function AnnotationSection({
  title,
  kinds,
  feature,
  activeFilters,
  onAddFilter,
}: {
  title: string
  kinds: ('alias' | 'xref' | 'ontology')[]
  feature: Feature
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-foreground">{title}</p>
      <FeatureAnnotationChips
        feature={feature}
        activeFilters={activeFilters}
        onAddFilter={onAddFilter}
        kinds={kinds}
      />
    </div>
  )
}

export function FeatureRowPopoverContent({
  feature,
  activeFilters,
  onAddFilter,
  onNavigate,
}: FeatureRowPopoverContentProps) {
  const gf = feature.genomicFeature
  const typeLabel = gf?.featureType?.label ?? gf?.featureType?.id
  const chips = featureQueryChips(feature)
  const hasAliases = chips.some((c) => c.kind === 'alias')
  const hasXrefs = chips.some((c) => c.kind === 'xref')
  const hasOntology = chips.some((c) => c.kind === 'ontology')

  return (
    <div className="text-popover-foreground">
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-sm font-semibold leading-snug">
          {featureDisplayLabel(feature)}
        </p>
        <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
          {feature.id}
        </p>
      </div>
      <div className="max-h-[min(60vh,22rem)] space-y-2.5 overflow-y-auto px-3 py-2.5 text-xs">
        <p className="text-muted-foreground">
          {featureAnnotationResource(feature) ?? '—'} ·{' '}
          {matrixCountForFeature(feature)} matrices
          {typeLabel ? ` · ${typeLabel}` : ''}
        </p>

        {hasAliases && (
          <AnnotationSection
            title="Aliases"
            kinds={['alias']}
            feature={feature}
            activeFilters={activeFilters}
            onAddFilter={onAddFilter}
          />
        )}
        {hasXrefs && (
          <AnnotationSection
            title="Xrefs"
            kinds={['xref']}
            feature={feature}
            activeFilters={activeFilters}
            onAddFilter={onAddFilter}
          />
        )}
        {hasOntology && (
          <AnnotationSection
            title="Ontologies"
            kinds={['ontology']}
            feature={feature}
            activeFilters={activeFilters}
            onAddFilter={onAddFilter}
          />
        )}

        <EntityRecordLink
          kind="feature"
          id={feature.id}
          onActivate={onNavigate}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Full record
        </EntityRecordLink>
      </div>
    </div>
  )
}
