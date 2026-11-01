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

/** Namespaces that are lookup keys, not ontology facets in the catalog. */
const NON_FACET_PREFIXES = new Set(['HGNC', 'NCBIGENE', 'ENSEMBL'])

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

  const featureGroups = useMemo(
    () =>
      groupTermsByNamespaceScope(terms).filter(
        (g) => g.scope === 'genomicFeature' && g.namespaceType !== 'alphanumeric'
      ),
    [terms]
  )

  const groupsByPrefix = useMemo(() => {
    const map = new Map<string, (typeof featureGroups)[0]>()
    for (const g of featureGroups) map.set(g.namespaceType, g)
    return map
  }, [featureGroups])

  const resourceByPrefix = useMemo(() => {
    const map = new Map<string, (typeof resources)[0]>()
    for (const r of resources) {
      if (r.nameSpacePrefix) map.set(r.nameSpacePrefix, r)
    }
    return map
  }, [resources])

  const namespaceItems = useMemo(() => {
    const items: Array<
      | { kind: 'collapse'; prefix: string; group: (typeof featureGroups)[0] }
      | { kind: 'resource'; prefix?: string; name?: string; id: string }
    > = []
    const seenCollapse = new Set<string>()

    for (const group of featureGroups) {
      items.push({ kind: 'collapse', prefix: group.namespaceType, group })
      seenCollapse.add(group.namespaceType)
    }

    for (const resource of resources) {
      const prefix = resource.nameSpacePrefix
      if (prefix && seenCollapse.has(prefix)) continue
      if (!prefix || NON_FACET_PREFIXES.has(prefix.toUpperCase())) {
        items.push({
          kind: 'resource',
          id: resource.id ?? prefix ?? resource.name ?? 'resource',
          prefix,
          name: resource.name ?? resource.id,
        })
      }
    }

    return items
  }, [featureGroups, resources])

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
              if (item.kind === 'collapse') {
                const resourceName =
                  resourceByPrefix.get(item.prefix)?.name ??
                  groupsByPrefix.get(item.prefix)?.namespaceLabel
                return (
                  <li key={`collapse-${item.prefix}`}>
                    <NamespaceTermCollapse
                      group={item.group}
                      scope="genomicFeature"
                      activeFilters={activeFilters}
                      onAddFilter={onAddFilter}
                      resourceName={resourceName}
                    />
                  </li>
                )
              }
              return (
                <li key={item.id}>
                  <NamespaceRow prefix={item.prefix} name={item.name} />
                </li>
              )
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
