'use client'

import { useMemo } from 'react'
import { NamespaceTermCollapse } from '@/components/shared/namespace-term-collapse'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { UiFilter } from '@/lib/beacon'
import { groupTermsByNamespaceScope } from '@/lib/scope-theme'

type GeneFilterSidebarProps = {
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
}

function NamespaceRow({
  prefix,
  name,
}: {
  prefix?: string
  name?: string
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/30 px-2.5 py-2">
      {prefix && (
        <p className="font-mono text-[11px] font-semibold text-foreground">{prefix}</p>
      )}
      {name && (
        <p className="text-xs leading-snug text-muted-foreground">{name}</p>
      )}
    </div>
  )
}

export function GeneFilterSidebar({ activeFilters, onAddFilter }: GeneFilterSidebarProps) {
  const { terms, resources, error, loading } = useFilteringTerms('/features/filtering_terms')

  const soGroup = useMemo(() => {
    return groupTermsByNamespaceScope(terms)
      .filter((g) => g.scope === 'genomicFeature' && g.namespaceType === 'SO')
      .at(0)
  }, [terms])

  const namespaceItems = useMemo(() => {
    const items: Array<
      | { kind: 'so' }
      | { kind: 'resource'; prefix?: string; name?: string; id: string }
    > = []

    for (const resource of resources) {
      const prefix = resource.nameSpacePrefix
      if (prefix === 'SO' && soGroup) {
        items.push({ kind: 'so' })
        continue
      }
      items.push({
        kind: 'resource',
        id: resource.id ?? prefix ?? resource.name ?? 'resource',
        prefix,
        name: resource.name ?? resource.id,
      })
    }

    if (soGroup && !items.some((item) => item.kind === 'so')) {
      items.unshift({ kind: 'so' })
    }

    return items
  }, [resources, soGroup])

  const soResourceName = resources.find((r) => r.nameSpacePrefix === 'SO')?.name

  return (
    <aside className="w-full min-w-0 shrink-0 lg:w-56 xl:w-64">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Namespaces
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
          GET /features/filtering_terms
        </p>

        {loading && <p className="mt-3 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        {!loading && !error && (
          <ul className="mt-3 space-y-2">
            {namespaceItems.map((item) => {
              if (item.kind === 'so' && soGroup) {
                return (
                  <li key="namespace-so">
                    <NamespaceTermCollapse
                      group={soGroup}
                      scope="genomicFeature"
                      activeFilters={activeFilters}
                      onAddFilter={onAddFilter}
                      resourceName={soResourceName}
                    />
                  </li>
                )
              }
              if (item.kind === 'resource') {
                return (
                  <li key={item.id}>
                    <NamespaceRow prefix={item.prefix} name={item.name} />
                  </li>
                )
              }
              return null
            })}
            {namespaceItems.length === 0 && (
              <li className="text-xs text-muted-foreground">No namespaces in catalog.</li>
            )}
          </ul>
        )}
      </div>
    </aside>
  )
}
