import Link from 'next/link'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import { buttonVariants } from '@/components/ui/button'
import type { BeaconInfo } from '@/lib/beacon'
import { cn } from '@/lib/utils'

function organizationName(info: BeaconInfo | null): string | null {
  const org = info?.organization
  if (!org) return null
  if (typeof org === 'string') return org.trim() || null
  return org.name?.trim() || org.id?.trim() || null
}

type HomeHeroProps = {
  info: BeaconInfo | null
}

export function HomeHero({ info }: HomeHeroProps) {
  const orgName = organizationName(info)

  return (
    <section id="overview" className="space-y-4 border-b border-border pb-6">
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
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        Demo of Beacon v2 matrices, genomic features, biosamples, and nested
        expression values — plus an Explore heatmap that joins those models.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/explore/" className={cn(buttonVariants({ size: 'sm' }))}>
          Open Explore
        </Link>
        <Link
          href="/matrices/"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          Browse matrices
        </Link>
      </div>
    </section>
  )
}
