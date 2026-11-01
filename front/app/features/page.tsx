'use client'

import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { CatalogPage } from '@/components/catalog-page'

export default function FeaturesPage() {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-14 text-sm text-[#71818a]">Loading…</p>}>
        <CatalogPage
          scope="feature"
          path="/features"
          base="/features/"
          kind="features"
          eyebrow="Search"
          title="Genes & features"
          description="Query genomic features with Beacon filters. Start from existence, then count, then records."
          endpoint="GET /features/filtering_terms · GET or POST /features"
        />
      </Suspense>
    </AppShell>
  )
}
