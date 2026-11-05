'use client'

import { useEffect, useState } from 'react'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import { DetailScalarGrid } from '@/components/shared/detail/detail-scalar-grid'
import { DetailScrollBody } from '@/components/shared/detail/detail-scroll-body'
import { DetailSection } from '@/components/shared/detail/detail-section'
import { DetailSurfaceHeader } from '@/components/shared/detail/detail-surface-header'
import { OntologyTermBadges } from '@/components/shared/detail/ontology-term-badges'
import { RelatedMatricesSection } from '@/components/shared/detail/related-matrices-section'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import {
  biosampleInfoScalarFacts,
  curieHref,
  linkedTerms,
} from '@/lib/beacon/facts'
import {
  getFilteringTerms,
  listRelatedMatrices,
  type Biosample,
  type FilteringResource,
  type Matrix,
} from '@/lib/beacon'
import {
  biosampleDisplayLabel,
  matrixCountForBiosample,
} from '@/lib/sample-lens'

function termRow(
  resources: FilteringResource[],
  label: string,
  term: Biosample['biosampleStatus']
) {
  if (!term) return null
  const terms = typeof term === 'string' ? [term] : [term]
  if (!terms.length) return null
  return (
    <DetailSection title={label}>
      <OntologyTermBadges terms={terms} resources={resources} variant="accent" />
    </DetailSection>
  )
}

type BiosampleDetailBodyProps = {
  sample: Biosample
  density?: 'popover' | 'drawer'
}

export function BiosampleDetailBody({
  sample,
  density = 'drawer',
}: BiosampleDetailBodyProps) {
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
    listRelatedMatrices('biosample', sample.id)
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
  }, [sample.id])

  const meta = `${matrixCountForBiosample(sample)} matrices`

  const infoRows = biosampleInfoScalarFacts(sample).map((f) => ({
    label: f.label,
    value: f.value,
    links: f.links,
    wide: f.label === 'Description' || f.label === 'Notes',
  }))

  const body = (
    <>
      <div className="space-y-2.5">
        {termRow(resources, 'Status', sample.biosampleStatus)}
        {termRow(resources, 'Origin type', sample.sampleOriginType)}
        {termRow(resources, 'Origin detail', sample.sampleOriginDetail)}
        {termRow(resources, 'Processing', sample.sampleProcessing)}
        {termRow(resources, 'Sample type', sample.sampleType)}

        {(sample.phenotypicFeatures?.length ?? 0) > 0 && (
          <DetailSection title="Phenotypes">
            <div className="space-y-2">
              {sample.phenotypicFeatures!.map((pf, i) => (
                <div key={i} className="rounded-md border border-border bg-muted/20 p-2">
                  <OntologyTermBadges
                    terms={
                      [pf.featureType, pf.severity].filter(
                        (t): t is NonNullable<typeof t> => Boolean(t)
                      )
                    }
                    resources={resources}
                  />
                  {pf.notes?.trim() ? (
                    <p className="mt-1 text-xs text-muted-foreground">{pf.notes.trim()}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {(sample.measurements?.length ?? 0) > 0 && (
          <DetailSection title="Measurements">
            <div className="flex flex-col gap-1.5">
              {sample.measurements!.map((m, i) => {
                const assay = m.assayCode
                const val = m.measurementValue?.value
                const unit = m.measurementValue?.unit
                const assayLinks = assay ? linkedTerms(resources, [assay]) : []
                const href = assay?.id ? curieHref(resources, assay.id) : assayLinks[0]?.href
                const label =
                  assayLinks[0]?.text ??
                  (typeof assay === 'object' ? assay?.label ?? assay?.id : assay)
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    {label ? (
                      href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:opacity-90"
                        >
                          <MetaBadge variant="accent" title={assay?.id}>
                            {label}
                          </MetaBadge>
                        </a>
                      ) : (
                        <MetaBadge variant="accent" title={assay?.id}>
                          {label}
                        </MetaBadge>
                      )
                    ) : null}
                    {val != null && (
                      <span className="tabular-nums text-foreground">
                        {val}
                        {unit
                          ? ` ${typeof unit === 'object' ? unit.label ?? unit.id : unit}`
                          : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </DetailSection>
        )}

        <DetailSection title="Sample info">
          <DetailScalarGrid rows={infoRows} />
        </DetailSection>
      </div>

      {density === 'drawer' && (
        <RelatedMatricesSection
          kind="biosample"
          entityId={sample.id}
          matrices={matrices}
          matrixTotal={matrixTotal}
          matrixError={matrixError}
          fallbackIds={sample.matrixIds ?? []}
        />
      )}
      {density === 'drawer' && (
        <LensMutedEndpoints
          className="mt-2"
          lines={[
            `GET /biosamples/${sample.id}`,
            `GET /biosamples/${sample.id}/matrices`,
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
          title={biosampleDisplayLabel(sample)}
          subtitle={sample.id}
          meta={meta || undefined}
        />
        <DetailScrollBody density="popover">{body}</DetailScrollBody>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DetailSurfaceHeader
        density="drawer"
        title={biosampleDisplayLabel(sample)}
        subtitle={sample.id}
        meta={meta || undefined}
      />
      <DetailScrollBody density="drawer">
        <div className="grid items-start gap-4">{body}</div>
      </DetailScrollBody>
    </div>
  )
}
