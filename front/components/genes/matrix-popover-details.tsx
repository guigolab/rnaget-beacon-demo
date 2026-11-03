'use client'

import { DetailHeaderIconLink } from '@/components/shared/detail/detail-header-icon-link'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import type { Matrix, OntologyTerm } from '@/lib/beacon/types'
import { matrixViewHref } from '@/lib/gene-lens'
import type { Feature } from '@/lib/beacon/types'
import { formatHeatmapValue } from '@/lib/heatmap-expression'

type MatrixPopoverDetailsProps = {
  matrix: Matrix
  feature?: Feature | null
  median?: number
  onNavigate?: () => void
}

function matrixFeatureTypes(matrix: Matrix): OntologyTerm[] {
  const raw = matrix.featureTypes ?? matrix.featureType
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function termChipLabel(term: OntologyTerm): string {
  return term.label?.trim() || term.id || '—'
}

export function MatrixPopoverDetails({
  matrix,
  feature,
  onNavigate,
}: MatrixPopoverDetailsProps) {
  const { min, max } = matrix.expressionValueRange ?? {}
  const unit = matrix.expressionUnitAndScale?.unit
  const scale = matrix.expressionUnitAndScale?.scale
  const matrixId = matrix.matrixId ?? ''
  const href = matrixViewHref(matrixId, feature ?? null)

  const biosamples = matrix.dimensions?.biosamples
  const features = matrix.dimensions?.features
  const annotation = matrix.annotation
  const assembly = matrix.assembly
  const assay = matrix.assayType
  const featureTypes = matrixFeatureTypes(matrix)

  const rangeChip =
    min != null && max != null && Number.isFinite(min) && Number.isFinite(max)
      ? `${formatHeatmapValue(min)}–${formatHeatmapValue(max)}${unit ? ` ${unit}` : ''}`
      : null

  const openLabel = feature ? 'Open matrix with this feature' : 'Open matrix workspace'

  return (
    <div className="text-popover-foreground text-xs">
      <DetailSurfaceHeader
        density="popover"
        title={matrix.name ?? matrixId}
        subtitle={matrixId}
        actions={
          <DetailHeaderIconLink href={href} label={openLabel} onClick={onNavigate} />
        }
      />
      <div className="border-b border-border px-3 pb-2.5">
        <div className="flex flex-wrap gap-1.5">
          {matrix.reproducible != null && (
            <MetaBadge variant={matrix.reproducible ? 'accent' : 'muted'}>
              {matrix.reproducible ? 'Reproducible' : 'Not reproducible'}
            </MetaBadge>
          )}
          {unit && <MetaBadge variant="accent">{unit}</MetaBadge>}
          {scale && scale !== 'linear' && <MetaBadge>{scale}</MetaBadge>}
          {!unit && !scale && <MetaBadge variant="muted">Unit n/a</MetaBadge>}
        </div>
      </div>

      <DetailScrollBody density="popover">
        {(biosamples != null || features != null) && (
          <p className="tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">Dimensions</span>{' '}
            biosamples{' '}
            <span className="font-semibold text-foreground">
              {biosamples?.toLocaleString() ?? '—'}
            </span>
            <span className="mx-1.5 text-muted-foreground/70">×</span>
            features{' '}
            <span className="font-semibold text-foreground">
              {features?.toLocaleString() ?? '—'}
            </span>
          </p>
        )}

        {(annotation?.source || assembly?.name) && (
          <p className="leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {annotation?.source && (
              <>
                <span className="font-medium text-foreground">Annotation</span>{' '}
                {annotation.source}
                {annotation.version ? ` ${annotation.version}` : ''}
              </>
            )}
            {annotation?.source && assembly?.name && (
              <span className="mx-1.5 text-muted-foreground/60">·</span>
            )}
            {assembly?.name && (
              <>
                <span className="font-medium text-foreground">Assembly</span>{' '}
                {assembly.name}
              </>
            )}
          </p>
        )}

        {matrix.description ? (
          <p className="leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {matrix.description}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {assay && (
            <MetaBadge variant="accent" title={assay.id}>
              {termChipLabel(assay)}
            </MetaBadge>
          )}
          {featureTypes.map((term) => (
            <MetaBadge key={term.id ?? term.label} title={term.id}>
              {termChipLabel(term)}
            </MetaBadge>
          ))}
          {rangeChip && (
            <MetaBadge variant="muted" title="Matrix expression value range">
              {rangeChip}
            </MetaBadge>
          )}
        </div>
      </DetailScrollBody>
    </div>
  )
}
