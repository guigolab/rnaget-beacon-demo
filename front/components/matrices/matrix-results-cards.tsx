'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import { matrixHref } from '@/lib/beacon'
import type { Matrix, OntologyTerm } from '@/lib/beacon/types'
import { matrixDisplayLabel } from '@/lib/matrix-lens'
import { formatHeatmapValue } from '@/lib/heatmap-expression'

type MatrixResultsCardsProps = {
  matrices: Matrix[]
}

function matrixFeatureTypes(matrix: Matrix): OntologyTerm[] {
  const raw = matrix.featureType
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function termChipLabel(term: OntologyTerm): string {
  return term.label?.trim() || term.id || '—'
}

function MatrixResultCard({ matrix }: { matrix: Matrix }) {
  const id = matrix.matrixId ?? ''
  const unit = matrix.expressionUnitAndScale?.unit
  const scale = matrix.expressionUnitAndScale?.scale
  const { min, max } = matrix.expressionValueRange ?? {}
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

  const workspaceHref = matrixHref(id)

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-border/80 hover:bg-muted/20 sm:flex-row sm:items-stretch">
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="min-w-0">
          <Link
            href={workspaceHref}
            className="text-base font-semibold leading-snug text-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            {matrixDisplayLabel(matrix)}
          </Link>
          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
            {id}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {matrix.reproducible != null && (
            <MetaBadge variant={matrix.reproducible ? 'accent' : 'muted'}>
              {matrix.reproducible ? 'Reproducible' : 'Not reproducible'}
            </MetaBadge>
          )}
          {unit && <MetaBadge variant="accent">{unit}</MetaBadge>}
          {scale && scale !== 'linear' && <MetaBadge>{scale}</MetaBadge>}
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
          {annotation?.source && (
            <MetaBadge title={annotation.version}>
              {annotation.source}
              {annotation.version ? ` ${annotation.version}` : ''}
            </MetaBadge>
          )}
          {assembly?.name && (
            <MetaBadge variant="muted" title={assembly.accession}>
              {assembly.name}
            </MetaBadge>
          )}
          {rangeChip && (
            <MetaBadge variant="muted" title="Expression value range">
              {rangeChip}
            </MetaBadge>
          )}
        </div>

        {(biosamples != null || features != null) && (
          <p className="mt-3 text-xs tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">Dimensions</span>{' '}
            {features?.toLocaleString() ?? '—'} features ×{' '}
            {biosamples?.toLocaleString() ?? '—'} biosamples
          </p>
        )}

        {matrix.description ? (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {matrix.description}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-center border-t border-border/80 px-4 py-3 sm:w-36 sm:border-l sm:border-t-0">
        <Link
          href={workspaceHref}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-muted sm:w-auto"
          title="Open matrix workspace"
        >
          Open
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  )
}

export function MatrixResultsCards({ matrices }: MatrixResultsCardsProps) {
  return (
    <div className="flex flex-col gap-3">
      {matrices.map((matrix) => {
        const id = matrix.matrixId ?? ''
        return <MatrixResultCard key={id} matrix={matrix} />
      })}
    </div>
  )
}
