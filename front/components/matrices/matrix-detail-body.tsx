'use client'

import { MetaBadge } from '@/components/shared/detail/meta-badge'
import {
  PageHeaderDownloadButtons,
  type PageHeaderDownloadItem,
} from '@/components/ui-kit'
import { ncbiAssemblyFtp, type Matrix } from '@/lib/beacon'
import type { OntologyTerm } from '@/lib/beacon/types'
import { formatHeatmapValue } from '@/lib/heatmap-expression'
import { matrixDisplayLabel } from '@/lib/matrix-lens'

function matrixFeatureTypes(matrix: Matrix): OntologyTerm[] {
  const raw = matrix.featureType
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function termChipLabel(term: OntologyTerm): string {
  return term.label?.trim() || term.id || '—'
}

export function matrixDetailDescription(matrix: Matrix): string | undefined {
  const trimmed = matrix.description?.trim()
  if (trimmed) return trimmed
  const features = matrix.dimensions?.features
  const biosamples = matrix.dimensions?.biosamples
  const unit = matrix.expressionUnitAndScale?.unit
  const parts: string[] = []
  if (features != null && biosamples != null) {
    parts.push(
      `${features.toLocaleString()} features × ${biosamples.toLocaleString()} biosamples`
    )
  }
  if (unit) parts.push(unit)
  return parts.length ? parts.join(' · ') : undefined
}

export type MatrixDownloadLink = { text: string; href: string; label: string }

export function matrixDownloadLinks(matrix: Matrix): MatrixDownloadLink[] {
  const links: MatrixDownloadLink[] = []
  const annotation = matrix.annotation
  const assembly = matrix.assembly

  const annotationName = [annotation?.source, annotation?.version]
    .filter(Boolean)
    .join(' ')
  if (annotation?.file) {
    links.push({
      label: 'Gene annotation',
      text: annotationName || 'Gene annotation',
      href: annotation.file,
    })
  }

  const assemblyName = assembly?.name?.trim()
  const assemblyAccession = assembly?.accession?.trim()
  const assemblyHref = ncbiAssemblyFtp(assembly?.accession, assembly?.name)
  if (assemblyHref) {
    links.push({
      label: 'Assembly',
      text: assemblyName || assemblyAccession || 'Assembly',
      href: assemblyHref,
    })
  }

  if (matrix.downloadUrl) {
    links.push({
      label: 'Matrix file',
      text: matrix.name?.trim() || matrix.matrixId || 'Matrix file',
      href: matrix.downloadUrl,
    })
  }

  return links
}

export function matrixPageHeaderDownloads(matrix: Matrix): PageHeaderDownloadItem[] {
  return matrixDownloadLinks(matrix).map(({ label, text, href }) => ({
    label,
    text,
    href,
    download: label === 'Matrix file',
  }))
}

type MatrixDetailMetaChipsProps = {
  matrix: Matrix
  /** When true, show feature-type chips (e.g. gene) and matrix value-range chip. */
  showFeatureTypes?: boolean
  showValueRange?: boolean
}

export function MatrixDetailMetaChips({
  matrix,
  showFeatureTypes = true,
  showValueRange = true,
}: MatrixDetailMetaChipsProps) {
  const unit = matrix.expressionUnitAndScale?.unit
  const scale = matrix.expressionUnitAndScale?.scale
  const { min, max } = matrix.expressionValueRange ?? {}
  const assay = matrix.assayType
  const featureTypes = matrixFeatureTypes(matrix)

  const rangeChip =
    showValueRange &&
    min != null &&
    max != null &&
    Number.isFinite(min) &&
    Number.isFinite(max)
      ? `${formatHeatmapValue(min)}–${formatHeatmapValue(max)}${unit ? ` ${unit}` : ''}`
      : null

  return (
    <div className="flex flex-wrap gap-1.5">
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
      {showFeatureTypes &&
        featureTypes.map((term) => (
          <MetaBadge key={term.id ?? term.label} title={term.id}>
            {termChipLabel(term)}
          </MetaBadge>
        ))}
      {rangeChip && (
        <MetaBadge variant="muted" title="Expression value range">
          {rangeChip}
        </MetaBadge>
      )}
    </div>
  )
}

/** Header badges: reproducibility, unit, assay — no feature type or range (range lives on heatmap scale). */
export function MatrixDetailHeaderBadges({ matrix }: { matrix: Matrix }) {
  return (
    <MatrixDetailMetaChips
      matrix={matrix}
      showFeatureTypes={false}
      showValueRange={false}
    />
  )
}

/** @deprecated Use PageHeader + MatrixDetailHeaderBadges + matrixPageHeaderDownloads. */
export function MatrixDetailBody({ matrix }: { matrix: Matrix }) {
  return (
    <section className="rounded-xl border border-[var(--scope-matrix-border)]/40 bg-card shadow-sm">
      <div className="space-y-4 px-4 py-4">
        <MatrixDetailMetaChips matrix={matrix} />
        {matrix.description?.trim() ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {matrix.description.trim()}
          </p>
        ) : null}
        <PageHeaderDownloadButtons items={matrixPageHeaderDownloads(matrix)} />
      </div>
    </section>
  )
}
