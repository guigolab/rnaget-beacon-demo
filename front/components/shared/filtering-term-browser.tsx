'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { AlphanumericTermCollapse } from '@/components/shared/alphanumeric-term-collapse'
import { NamespaceTermCollapse } from '@/components/shared/namespace-term-collapse'
import type { UiFilter } from '@/lib/beacon'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import {
  browsableTerms,
  isHiddenFilteringTerm,
  isLookupPrefix,
  lookupExample,
} from '@/lib/lens-catalog'
import {
  groupTermsByNamespaceScope,
  resourceAllowedInScope,
  type BeaconScope,
  type NamespaceScopeGroup,
} from '@/lib/scope-theme'

type FilteringTermBrowserProps = {
  scope: BeaconScope
  terms: FilteringTerm[]
  resources: FilteringResource[]
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  loading?: boolean
  error?: string
  variant?: 'sidebar' | 'embedded'
}

function customNamespaceGroup(
  scope: BeaconScope,
  terms: FilteringTerm[]
): NamespaceScopeGroup | null {
  if (!terms.length) return null
  return {
    key: `custom|${scope}`,
    namespaceType: 'custom',
    namespaceLabel: 'custom',
    scope,
    terms,
    count: terms.length,
    valueCount: terms.length,
  }
}

export function FilteringTermBrowser({
  scope,
  terms,
  resources,
  activeFilters,
  onAddFilter,
  loading = false,
  error = '',
  variant = 'sidebar',
}: FilteringTermBrowserProps) {
  const visible = useMemo(() => browsableTerms(terms), [terms])

  const ontologyGroups = useMemo(
    () =>
      groupTermsByNamespaceScope(visible).filter(
        (group) =>
          group.scope === scope &&
          group.namespaceType !== 'alphanumeric' &&
          group.namespaceType !== 'custom'
      ),
    [scope, visible]
  )

  const alphanumericTerms = useMemo(
    () =>
      visible.filter(
        (term) =>
          term.type === 'alphanumeric' &&
          (term.scopes?.includes(scope) ?? false) &&
          (term.values?.length ?? 0) > 0
      ),
    [scope, visible]
  )

  const customTerms = useMemo(
    () =>
      visible.filter(
        (term) =>
          term.type === 'custom' &&
          !isHiddenFilteringTerm(term) &&
          (term.scopes?.includes(scope) ?? false)
      ),
    [scope, visible]
  )

  const customGroup = useMemo(
    () => customNamespaceGroup(scope, customTerms),
    [customTerms, scope]
  )

  const resourceByPrefix = useMemo(() => {
    const map = new Map<string, FilteringResource>()
    for (const resource of resources) {
      if (resource.nameSpacePrefix) map.set(resource.nameSpacePrefix, resource)
    }
    return map
  }, [resources])

  const collapsedPrefixes = useMemo(
    () => new Set(ontologyGroups.map((group) => group.namespaceType)),
    [ontologyGroups]
  )

  /** Scoped resources with no term group yet (lookups + ontology like GO). */
  const resourceOnlyNamespaces = useMemo(
    () =>
      resources.filter(
        (resource) =>
          resourceAllowedInScope(scope, resource) &&
          Boolean(resource.nameSpacePrefix) &&
          !collapsedPrefixes.has(resource.nameSpacePrefix ?? '')
      ),
    [collapsedPrefixes, resources, scope]
  )

  if (variant === 'embedded' && loading) {
    return <p className="text-xs text-muted-foreground">Loading terms…</p>
  }
  if (variant === 'embedded' && error) {
    return <p className="text-xs text-destructive">{error}</p>
  }

  const empty =
    ontologyGroups.length === 0 &&
    alphanumericTerms.length === 0 &&
    !customGroup &&
    resourceOnlyNamespaces.length === 0

  return (
    <ul className={variant === 'embedded' ? 'space-y-2' : 'space-y-2'}>
      {ontologyGroups.map((group) => (
        <li key={group.key}>
          <NamespaceTermCollapse
            group={group}
            scope={scope}
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
            scope={scope}
            activeFilters={activeFilters}
            onAddFilter={onAddFilter}
          />
        </li>
      ))}
      {customGroup && (
        <li key={customGroup.key}>
          <NamespaceTermCollapse
            group={customGroup}
            scope={scope}
            activeFilters={activeFilters}
            onAddFilter={onAddFilter}
          />
        </li>
      )}
      {resourceOnlyNamespaces.map((resource) => {
        const prefix = resource.nameSpacePrefix ?? ''
        const hint = isLookupPrefix(prefix)
          ? `type ${lookupExample(prefix)}`
          : 'no catalogued terms · type CURIE in query'
        return (
          <li key={resource.id ?? prefix}>
            <div className="min-w-0 rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-2">
              <p className="font-mono text-[11px] font-semibold text-foreground">
                {prefix}
              </p>
              <p className="text-xs leading-snug text-muted-foreground">
                {resource.name ?? resource.id}
                <span className="text-muted-foreground/80">
                  {' · '}
                  {hint}
                </span>
              </p>
            </div>
          </li>
        )
      })}
      {empty && <li className="text-xs text-muted-foreground">No terms in this catalog.</li>}
    </ul>
  )
}

export function FilteringTermSidebar({
  source,
  loading,
  error,
  children,
}: {
  source: string
  loading: boolean
  error: string
  children: ReactNode
}) {
  return (
    <aside className="w-full min-w-0 shrink-0 lg:w-56 xl:w-64">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Namespaces
        </h2>
        <div className="mt-1 min-w-0 truncate" title={source}>
          <LensMutedEndpoints lines={[source]} />
        </div>
        {loading && <p className="mt-3 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        {!loading && !error && <div className="mt-3">{children}</div>}
      </div>
    </aside>
  )
}
