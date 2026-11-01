'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { AlphanumericTermCollapse } from '@/components/shared/alphanumeric-term-collapse'
import { NamespaceTermCollapse } from '@/components/shared/namespace-term-collapse'
import { filterKey, type UiFilter } from '@/lib/beacon'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'
import {
  browsableTerms,
  isHiddenFilteringTerm,
  isLookupPrefix,
  lookupExample,
  termToUiFilter,
} from '@/lib/lens-catalog'
import { groupTermsByNamespaceScope, type BeaconScope } from '@/lib/scope-theme'

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

function activeTermIds(filters: UiFilter[]): Set<string> {
  const ids = new Set<string>()
  for (const filter of filters) {
    if (filter.kind === 'ontology' || filter.kind === 'custom') {
      ids.add(filter.id.toLowerCase())
    }
    if (filter.kind === 'alphanumeric' || filter.kind === 'sex') {
      ids.add(filterKey(filter))
    }
  }
  return ids
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

  const lookupResources = useMemo(
    () =>
      resources.filter(
        (resource) =>
          isLookupPrefix(resource.nameSpacePrefix) &&
          !collapsedPrefixes.has(resource.nameSpacePrefix ?? '')
      ),
    [collapsedPrefixes, resources]
  )

  const activeIds = useMemo(() => activeTermIds(activeFilters), [activeFilters])

  if (variant === 'embedded' && loading) {
    return <p className="text-xs text-muted-foreground">Loading terms…</p>
  }
  if (variant === 'embedded' && error) {
    return <p className="text-xs text-destructive">{error}</p>
  }

  const empty =
    ontologyGroups.length === 0 &&
    alphanumericTerms.length === 0 &&
    customTerms.length === 0 &&
    lookupResources.length === 0

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
      {customTerms.map((term) => {
        const filter = termToUiFilter(term)
        const selected = activeIds.has(term.id.toLowerCase())
        const label = term.label ?? term.id
        return (
          <li key={term.id}>
            <button
              type="button"
              disabled={selected}
              title={selected ? `${label} · in query` : term.id}
              className="block w-full min-w-0 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-left hover:bg-muted/50 disabled:cursor-default disabled:opacity-50"
              onClick={() => onAddFilter(filter)}
            >
              <span className="block text-xs font-medium text-foreground">{label}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                {term.id}
              </span>
            </button>
          </li>
        )
      })}
      {lookupResources.map((resource) => (
        <li key={resource.id ?? resource.nameSpacePrefix}>
          <div className="min-w-0 rounded-md border border-border bg-muted/30 px-2.5 py-2">
            <p className="font-mono text-[11px] font-semibold text-foreground">
              {resource.nameSpacePrefix}
            </p>
            <p className="text-xs leading-snug text-muted-foreground">
              {resource.name ?? resource.id}
              <span className="text-muted-foreground/80">
                {' · '}
                type {lookupExample(resource.nameSpacePrefix ?? '')}
              </span>
            </p>
          </div>
        </li>
      ))}
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
        <p className="mt-1 truncate text-[11px] leading-relaxed text-muted-foreground/80" title={source}>
          {source}
        </p>
        {loading && <p className="mt-3 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        {!loading && !error && <div className="mt-3">{children}</div>}
      </div>
    </aside>
  )
}
