'use client'

import { useEffect, useState } from 'react'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import { FeatureDetailSections } from '@/components/features/feature-detail-sections'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { RelatedMatricesSection } from '@/components/shared/detail/related-matrices-section'
import {
  getFilteringTerms,
  listRelatedMatrices,
  type Feature,
  type FilteringResource,
  type Matrix,
} from '@/lib/beacon'
import {
  featureAnnotationResource,
  featureDisplayLabel,
  matrixCountForFeature,
} from '@/lib/gene-lens'

type FeatureDetailBodyProps = {
  feature: Feature
  density?: 'popover' | 'drawer'
}

export function FeatureDetailBody({
  feature,
  density = 'drawer',
}: FeatureDetailBodyProps) {
  const [resources, setResources] = useState<FilteringResource[]>([])
  const [matrices, setMatrices] = useState<Matrix[] | null>(null)
  const [matrixTotal, setMatrixTotal] = useState<number | null>(null)
  const [matrixError, setMatrixError] = useState('')

  useEffect(() => {
    let cancelled = false
    getFilteringTerms('/filtering_terms')
      .then((terms) => {
        if (!cancelled) setResources(terms.resources)
      })
      .catch(() => {
        if (!cancelled) setResources([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setMatrices(null)
    setMatrixError('')
    listRelatedMatrices('feature', feature.id)
      .then((page) => {
        if (cancelled) return
        setMatrices(page.results)
        setMatrixTotal(page.total ?? page.results.length)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMatrixError(
            err instanceof Error ? err.message : 'Related matrices failed'
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [feature.id])

  const gf = feature.genomicFeature
  const typeLabel = gf?.featureType?.label ?? gf?.featureType?.id
  const meta = [
    featureAnnotationResource(feature) ?? '—',
    `${matrixCountForFeature(feature)} matrices`,
    typeLabel,
  ]
    .filter(Boolean)
    .join(' · ')

  const body = (
    <>
      <FeatureDetailSections feature={feature} resources={resources} readOnly />
      {density === 'drawer' && (
        <RelatedMatricesSection
          kind="feature"
          entityId={feature.id}
          matrices={matrices}
          matrixTotal={matrixTotal}
          matrixError={matrixError}
          fallbackIds={feature.matrixIds ?? []}
        />
      )}
      {density === 'drawer' && (
        <LensMutedEndpoints
          className="mt-2"
          lines={[
            `GET /features/${feature.id}`,
            `GET /features/${feature.id}/matrices`,
          ]}
        />
      )}
    </>
  )

  if (density === 'popover') {
    return (
      <div className="text-popover-foreground">
        <DetailSurfaceHeader
          density="popover"
          title={featureDisplayLabel(feature)}
          subtitle={feature.id}
          meta={meta}
        />
        <DetailScrollBody density="popover">{body}</DetailScrollBody>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DetailSurfaceHeader
        density="drawer"
        title={featureDisplayLabel(feature)}
        subtitle={feature.id}
        meta={meta}
      />
      <DetailScrollBody density="drawer">
        <div className="grid items-start gap-4">{body}</div>
      </DetailScrollBody>
    </div>
  )
}
