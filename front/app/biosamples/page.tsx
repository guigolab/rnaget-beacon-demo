'use client'

import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { CatalogPage } from '@/components/catalog-page'

export default function BiosamplesPage() {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-14 text-sm text-[#71818a]">Loading…</p>}>
        <CatalogPage
          scope="biosample"
          path="/biosamples"
          base="/biosamples/"
          kind="biosamples"
          eyebrow="Search"
          title="Biosamples"
          description="Query biosamples by ontology, sex, or GEO sample, then follow a sample into its matrices."
          endpoint="GET /biosamples/filtering_terms · GET or POST /biosamples"
        />
      </Suspense>
    </AppShell>
  )
}
