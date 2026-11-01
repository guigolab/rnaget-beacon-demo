'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
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
  const raw = matrix.featureType
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function termChipLabel(term: OntologyTerm): string {
  return term.label?.trim() || term.id || '—'
}

function MetaBadge({
  children,
  variant = 'default',
  title,
}: {
  children: ReactNode
  variant?: 'default' | 'accent' | 'muted'
  title?: string
}) {
  const styles =
    variant === 'accent'
      ? 'border-primary/35 bg-primary/10 text-foreground'
      : variant === 'muted'
        ? 'border-border bg-muted/50 text-muted-foreground'
        : 'border-border bg-background text-foreground'
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${styles}`}
    >
      {children}
    </span>
  )
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

  return (
    <div className="text-popover-foreground text-xs">
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-sm font-semibold leading-snug">
          {matrix.name ?? matrixId}
        </p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {matrixId}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
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

      <div className="max-h-[min(60vh,22rem)] space-y-2.5 overflow-y-auto px-3 py-2.5">
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

        <Link
          href={href}
          className="inline-block font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => onNavigate?.()}
        >
          {feature ? 'Open matrix with this feature' : 'Open matrix workspace'}
        </Link>
      </div>
    </div>
  )
}
