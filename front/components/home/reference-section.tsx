'use client'

import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { BeaconMapSection } from '@/components/home/beacon-map-section'
import { ExploreHowItWorks } from '@/components/home/explore-how-it-works'
import type { BeaconMap } from '@/lib/beacon'

function Disclosure({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)

  // Opening the page at #id (or clicking an anchor to it) expands the panel.
  useEffect(() => {
    function openIfTargeted() {
      if (window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true
      }
    }
    openIfTargeted()
    window.addEventListener('hashchange', openIfTargeted)
    return () => window.removeEventListener('hashchange', openIfTargeted)
  }, [id])

  return (
    <details
      ref={ref}
      id={id}
      className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block text-[11px] text-muted-foreground">{hint}</span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  )
}

type ReferenceSectionProps = {
  map: BeaconMap | null
}

/** Secondary material, collapsed by default so the page stays short. */
export function ReferenceSection({ map }: ReferenceSectionProps) {
  return (
    <section id="reference" className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Reference
      </h2>
      <div className="space-y-2">
        {map && (
          <Disclosure
            id="endpoint-map"
            title="Endpoint map"
            hint="Paths advertised for each entry type and nested lookup."
          >
            <BeaconMapSection map={map} hideHeading />
          </Disclosure>
        )}
        <Disclosure
          id="explore"
          title="How Explore uses the models"
          hint="Features, biosamples, matrices and expression values joined into one gene × tissue view."
        >
          <ExploreHowItWorks hideHeading />
        </Disclosure>
      </div>
    </section>
  )
}
