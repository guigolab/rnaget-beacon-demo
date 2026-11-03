import type { ReactNode } from 'react'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import type { BeaconConfiguration, BeaconInfo, ServiceInfo } from '@/lib/beacon'

function organizationName(info: BeaconInfo | null): string | null {
  const org = info?.organization
  if (!org) return null
  if (typeof org === 'string') return org.trim() || null
  return org.name?.trim() || org.id?.trim() || null
}

function serviceTypeLabel(service: ServiceInfo | null): string | null {
  const t = service?.type
  if (!t?.group && !t?.artifact) return null
  return [t.group, t.artifact, t.version].filter(Boolean).join(':')
}

function FactRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 max-w-[75%] flex-wrap justify-end gap-1.5 text-right">
        {children}
      </dd>
    </div>
  )
}

function FactEmpty() {
  return <span className="text-sm text-muted-foreground">—</span>
}

function FactText({ children }: { children: ReactNode }) {
  return <span className="text-sm text-foreground">{children}</span>
}

function ServiceInfoCard({ service }: { service: ServiceInfo | null }) {
  const typeLabel = serviceTypeLabel(service)
  const orgName = service?.organization?.name?.trim() || null
  const orgUrl = service?.organization?.url?.trim() || null

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/20 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Service info
        </p>
        <div className="mt-1">
          <LensMutedEndpoints lines={['GET /service-info']} />
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 py-1">
        {!service ? (
          <p className="py-3 text-sm text-muted-foreground">Service info unavailable.</p>
        ) : (
          <dl>
            <FactRow label="Id">
              {service.id ? (
                <span className="break-all font-mono text-[11px] text-foreground">
                  {service.id}
                </span>
              ) : (
                <FactEmpty />
              )}
            </FactRow>
            <FactRow label="Name">
              {service.name ? <FactText>{service.name}</FactText> : <FactEmpty />}
            </FactRow>
            <FactRow label="Type">
              {typeLabel ? (
                <MetaBadge variant="muted">{typeLabel}</MetaBadge>
              ) : (
                <FactEmpty />
              )}
            </FactRow>
            <FactRow label="Version">
              {service.version ? (
                <MetaBadge variant="accent">{service.version}</MetaBadge>
              ) : (
                <FactEmpty />
              )}
            </FactRow>
            <FactRow label="Environment">
              {service.environment ? (
                <MetaBadge>{service.environment}</MetaBadge>
              ) : (
                <FactEmpty />
              )}
            </FactRow>
            <FactRow label="Organization">
              {orgName || orgUrl ? (
                orgUrl ? (
                  <a
                    href={orgUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex"
                  >
                    <MetaBadge title={orgUrl}>{orgName || orgUrl}</MetaBadge>
                  </a>
                ) : (
                  <MetaBadge>{orgName}</MetaBadge>
                )
              ) : (
                <FactEmpty />
              )}
            </FactRow>
            <FactRow label="Description">
              {service.description ? (
                <p className="text-left text-sm leading-snug text-foreground">
                  {service.description}
                </p>
              ) : (
                <FactEmpty />
              )}
            </FactRow>
          </dl>
        )}
      </div>
    </article>
  )
}

function ConfigurationCard({
  configuration,
}: {
  configuration: BeaconConfiguration | null
}) {
  const maturity = configuration?.maturityAttributes?.productionStatus
  const granularity = configuration?.securityAttributes?.defaultGranularity
  const levels = configuration?.securityAttributes?.securityLevels ?? []

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/20 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Configuration
        </p>
        <div className="mt-1">
          <LensMutedEndpoints lines={['GET /configuration']} />
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 py-1">
        {!configuration ? (
          <p className="py-3 text-sm text-muted-foreground">Configuration unavailable.</p>
        ) : (
          <dl>
            <FactRow label="Production status">
              {maturity ? (
                <MetaBadge variant="accent">{maturity}</MetaBadge>
              ) : (
                <FactEmpty />
              )}
            </FactRow>
            <FactRow label="Default granularity">
              {granularity ? (
                <MetaBadge>{String(granularity)}</MetaBadge>
              ) : (
                <FactEmpty />
              )}
            </FactRow>
            <FactRow label="Security levels">
              {levels.length > 0 ? (
                levels.map((level) => (
                  <MetaBadge key={level} variant="muted">
                    {level}
                  </MetaBadge>
                ))
              ) : (
                <FactEmpty />
              )}
            </FactRow>
          </dl>
        )}
      </div>
    </article>
  )
}

type HomeHeroProps = {
  info: BeaconInfo | null
  service: ServiceInfo | null
  configuration?: BeaconConfiguration | null
}

export function HomeHero({
  info,
  service,
  configuration = null,
}: HomeHeroProps) {
  const orgName = organizationName(info)

  return (
    <div className="space-y-6">
      <section className="space-y-2 border-b border-border pb-6">
        <LensMutedEndpoints lines={['GET /info']} />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {info?.name ?? 'RNA-Get Beacon'}
        </h1>
        {info?.id && (
          <p className="font-mono text-xs text-muted-foreground">{info.id}</p>
        )}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {orgName && <MetaBadge>{orgName}</MetaBadge>}
          {info?.environment && <MetaBadge>{info.environment}</MetaBadge>}
          {info?.apiVersion && (
            <MetaBadge variant="accent">{info.apiVersion}</MetaBadge>
          )}
        </div>
        {info?.description && (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {info.description}
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <ServiceInfoCard service={service} />
        <ConfigurationCard configuration={configuration} />
      </section>
    </div>
  )
}
