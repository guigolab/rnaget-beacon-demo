'use client'

import { useMemo } from 'react'
import { AlphanumericTermCollapse } from '@/components/shared/alphanumeric-term-collapse'
import { NamespaceTermCollapse } from '@/components/shared/namespace-term-collapse'
import { useFilteringTerms } from '@/hooks/use-filtering-terms'
import type { UiFilter } from '@/lib/beacon'
import { groupTermsByNamespaceScope } from '@/lib/scope-theme'

type MatrixFilterSidebarProps = {
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

export function MatrixFilterSidebar({
  activeFilters,
  onAddFilter,
}: MatrixFilterSidebarProps) {
  const { terms, resources, error, loading } = useFilteringTerms(
    '/matrices/filtering_terms'
  )

  const matrixGroups = useMemo(
    () =>
      groupTermsByNamespaceScope(terms).filter(
        (g) => g.scope === 'matrix' && g.namespaceType !== 'alphanumeric'
      ),
    [terms]
  )

  const alphanumericTerms = useMemo(
    () =>
      terms.filter(
        (t) =>
          t.type === 'alphanumeric' &&
          (t.scopes?.includes('matrix') ?? false) &&
          (t.values?.length ?? 0) > 0
      ),
    [terms]
  )

  const resourceByPrefix = useMemo(() => {
    const map = new Map<string, (typeof resources)[0]>()
    for (const r of resources) {
      if (r.nameSpacePrefix) map.set(r.nameSpacePrefix, r)
    }
    return map
  }, [resources])

  const collapsedPrefixes = useMemo(
    () => new Set(matrixGroups.map((g) => g.namespaceType)),
    [matrixGroups]
  )

  return (
    <aside className="w-full min-w-0 shrink-0 lg:w-56 xl:w-64">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Namespaces
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
          GET /matrices/filtering_terms
        </p>

        {loading && <p className="mt-3 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        {!loading && !error && (
          <ul className="mt-3 space-y-2">
            {matrixGroups.map((group) => (
              <li key={group.key}>
                <NamespaceTermCollapse
                  group={group}
                  scope="matrix"
                  activeFilters={activeFilters}
                  onAddFilter={onAddFilter}
                  resourceName={resourceByPrefix.get(group.namespaceType)?.name}
                />
              </li>
            ))}
            {alphanumericTerms.map((term) => (
              <li key={term.id}>
                <AlphanumericTermCollapse
                  term={term}
                  scope="matrix"
                  activeFilters={activeFilters}
                  onAddFilter={onAddFilter}
                />
              </li>
            ))}
            {resources
              .filter(
                (r) =>
                  r.nameSpacePrefix &&
                  !collapsedPrefixes.has(r.nameSpacePrefix)
              )
              .map((resource) => (
                <li key={resource.id ?? resource.nameSpacePrefix}>
                  <NamespaceRow
                    prefix={resource.nameSpacePrefix}
                    name={resource.name ?? resource.id}
                  />
                </li>
              ))}
            {matrixGroups.length === 0 && alphanumericTerms.length === 0 && (
              <li className="text-xs text-muted-foreground">No namespaces in catalog.</li>
            )}
          </ul>
        )}
      </div>
    </aside>
  )
}
