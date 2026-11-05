'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Accordion } from '@base-ui/react/accordion'
import { ChevronDown } from 'lucide-react'
import type { UiFilter } from '@/lib/beacon'
import { filterKey, filterLabel } from '@/lib/beacon'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import {
  browsableTerms,
  catalogValueDisplayLabel,
  isHiddenFilteringTerm,
  termToUiFilter,
  valuedTermChips,
} from '@/lib/lens-catalog'
import {
  groupTermsByNamespaceScope,
  type BeaconScope,
  type NamespaceScopeGroup,
} from '@/lib/scope-theme'
import { cn } from '@/lib/utils'

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

export function customNamespaceGroup(
  scope: BeaconScope,
  terms: FilteringTerm[]
): NamespaceScopeGroup | null {
  if (!terms.length) return null
  const namespaceLabel =
    scope === 'genomicFeature'
      ? 'Expression and gene type'
      : scope === 'biosample'
        ? 'Sample filters'
        : 'custom'
  return {
    key: `custom|${scope}`,
    namespaceType: 'custom',
    namespaceLabel,
    scope,
    terms,
    count: terms.length,
    valueCount: terms.length,
  }
}

function AccordionTriggerRow({
  title,
  detail,
  count,
  countLabel,
}: {
  title: string
  detail?: string
  count: number
  countLabel: string
}) {
  return (
    <Accordion.Header className="m-0 shrink-0">
      <Accordion.Trigger
        className={cn(
          'group flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left outline-none',
          'hover:bg-muted/55 focus-visible:bg-muted/55',
          'data-panel-open:bg-muted/40'
        )}
        title={detail ? `${title} · ${detail}` : title}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-wide text-foreground">
          {title}
        </span>
        {detail ? (
          <span className="hidden min-w-0 max-w-[40%] truncate text-[11px] text-muted-foreground sm:inline">
            {detail}
          </span>
        ) : null}
        <span
          className="shrink-0 tabular-nums text-[10px] text-muted-foreground"
          aria-label={`${count} ${countLabel}`}
        >
          {count}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none group-data-panel-open:rotate-180"
          aria-hidden
        />
      </Accordion.Trigger>
    </Accordion.Header>
  )
}

function TermSearchList({
  placeholder,
  fill,
  children,
}: {
  placeholder: string
  fill?: boolean
  children: (query: string) => ReactNode
}) {
  const [query, setQuery] = useState('')
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 px-3 pb-3 pt-1.5',
        fill && 'h-full min-h-0'
      )}
    >
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full min-w-0 shrink-0 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <ul
        className={cn(
          'overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:thin]',
          fill ? 'min-h-0 flex-1' : 'max-h-48'
        )}
      >
        {children(query)}
      </ul>
    </div>
  )
}

const accordionEase =
  'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none'

function accordionItemClass(fill: boolean) {
  return cn(
    'border-b border-border last:border-b-0',
    fill && 'flex flex-col data-open:min-h-0 data-open:flex-1'
  )
}

function accordionPanelClass(fill: boolean) {
  // Expand-only motion. Collapse is forced instant via controlled close-then-open
  // handoff in FilteringTermBrowser (avoids the lower panel flashing over the upper).
  if (fill) {
    return cn(
      accordionEase,
      'flex min-h-0 flex-1 flex-col overflow-hidden data-open:!h-auto',
      'opacity-100 transition-opacity',
      'data-starting-style:opacity-0',
      'data-ending-style:hidden data-ending-style:transition-none'
    )
  }
  return cn(
    accordionEase,
    'h-[var(--accordion-panel-height)] overflow-hidden transition-[height,opacity]',
    'data-starting-style:h-0 data-starting-style:opacity-0',
    'data-ending-style:hidden data-ending-style:transition-none'
  )
}

type CustomChipRow =
  | { kind: 'value'; key: string; filter: UiFilter; searchText: string }
  | {
      kind: 'term'
      key: string
      term: FilteringTerm
      filter: UiFilter
      searchText: string
    }

export function OntologyTermPicker({
  group,
  activeFilters,
  onAddFilter,
  fill,
}: {
  group: NamespaceScopeGroup
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  fill?: boolean
}) {
  const activeKeys = useMemo(
    () => new Set(activeFilters.map((f) => filterKey(f))),
    [activeFilters]
  )
  const sortedTerms = useMemo(
    () =>
      [...group.terms].sort((a, b) =>
        (a.label ?? a.id).localeCompare(b.label ?? b.id)
      ),
    [group.terms]
  )
  const title = (group.namespaceType || 'unknown').toUpperCase()
  const searchPlaceholder =
    group.namespaceType === 'custom' ? 'Search terms…' : `Search ${title}…`

  const customRows = useMemo((): CustomChipRow[] | null => {
    if (group.namespaceType !== 'custom') return null
    const rows: CustomChipRow[] = []
    for (const term of sortedTerms) {
      const chips = valuedTermChips(term)
      if (chips) {
        for (const filter of chips) {
          const label = filterLabel(filter)
          rows.push({
            kind: 'value',
            key: filterKey(filter),
            filter,
            searchText: `${label} ${term.id} ${term.label ?? ''}`.toLowerCase(),
          })
        }
        continue
      }
      const filter = termToUiFilter(term)
      const label = term.label ?? term.id
      rows.push({
        kind: 'term',
        key: term.id,
        term,
        filter,
        searchText: `${label} ${term.id}`.toLowerCase(),
      })
    }
    return rows
  }, [group.namespaceType, sortedTerms])

  return (
    <TermSearchList placeholder={searchPlaceholder} fill={fill}>
      {(query) => {
        const q = query.trim().toLowerCase()
        if (customRows) {
          const filtered = !q
            ? customRows
            : customRows.filter((row) => row.searchText.includes(q))
          if (!filtered.length) {
            return (
              <li className="py-2 text-xs text-muted-foreground">No matches.</li>
            )
          }
          return filtered.map((row) => {
            const selected = activeKeys.has(filterKey(row.filter))
            if (row.kind === 'value') {
              const label = filterLabel(row.filter)
              return (
                <li key={row.key} className="min-w-0">
                  <button
                    type="button"
                    disabled={selected}
                    title={selected ? `${label} · in query` : label}
                    className="block w-full min-w-0 rounded-sm px-1.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-muted/70 disabled:cursor-default disabled:opacity-50"
                    onClick={() => onAddFilter(row.filter)}
                  >
                    {label}
                  </button>
                </li>
              )
            }
            const label = row.term.label ?? row.term.id
            return (
              <li key={row.key} className="min-w-0">
                <button
                  type="button"
                  disabled={selected}
                  title={
                    selected
                      ? `${label} (${row.term.id}) · in query`
                      : `${label} (${row.term.id})`
                  }
                  className="block w-full min-w-0 rounded-sm px-1.5 py-1.5 text-left hover:bg-muted/70 disabled:cursor-default disabled:opacity-50"
                  onClick={() => onAddFilter(row.filter)}
                >
                  <span className="block text-xs font-medium leading-snug text-foreground [overflow-wrap:anywhere]">
                    {label}
                  </span>
                  {row.term.label && row.term.label !== row.term.id ? (
                    <span className="mt-0.5 block font-mono text-[10px] leading-tight text-muted-foreground [overflow-wrap:anywhere]">
                      {row.term.id}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })
        }
        const filtered = !q
          ? sortedTerms
          : sortedTerms.filter((term) => {
              const label = (term.label ?? '').toLowerCase()
              return label.includes(q) || term.id.toLowerCase().includes(q)
            })
        if (!filtered.length) {
          return (
            <li className="py-2 text-xs text-muted-foreground">No matches.</li>
          )
        }
        return filtered.map((term) => {
          const filter = termToUiFilter(term)
          const selected = activeKeys.has(filterKey(filter))
          const label = term.label ?? term.id
          return (
            <li key={term.id} className="min-w-0">
              <button
                type="button"
                disabled={selected}
                title={
                  selected
                    ? `${label} (${term.id}) · in query`
                    : `${label} (${term.id})`
                }
                className="block w-full min-w-0 rounded-sm px-1.5 py-1.5 text-left hover:bg-muted/70 disabled:cursor-default disabled:opacity-50"
                onClick={() => onAddFilter(filter)}
              >
                <span className="block text-xs font-medium leading-snug text-foreground [overflow-wrap:anywhere]">
                  {label}
                </span>
                {term.label && term.label !== term.id ? (
                  <span className="mt-0.5 block font-mono text-[10px] leading-tight text-muted-foreground [overflow-wrap:anywhere]">
                    {term.id}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })
      }}
    </TermSearchList>
  )
}

export function ontologyGroupChipCount(group: NamespaceScopeGroup): number {
  if (group.namespaceType !== 'custom') return group.count
  let count = 0
  for (const term of group.terms) {
    const chips = valuedTermChips(term)
    count += chips?.length ?? 1
  }
  return count
}

export function AlphanumericTermPicker({
  term,
  activeFilters,
  onAddFilter,
  fill,
}: {
  term: FilteringTerm
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  fill?: boolean
}) {
  const values = useMemo(
    () => [...(term.values ?? [])].sort((a, b) => a.localeCompare(b)),
    [term.values]
  )
  const activeKeys = useMemo(
    () => new Set(activeFilters.map((f) => filterKey(f))),
    [activeFilters]
  )
  if (!values.length) return null

  const title = term.label ?? term.id

  function selectValue(value: string) {
    const display = catalogValueDisplayLabel(term.id, value)
    if (term.id === 'matrix.profileSource') {
      onAddFilter({
        kind: 'custom',
        id: `matrix.profileSource:${value}`,
        label: `${title} = ${display}`,
      })
      return
    }
    onAddFilter({
      kind: 'alphanumeric',
      id: term.id,
      value,
      label: `${title} = ${display}`,
    })
  }

  return (
    <TermSearchList placeholder="Search values…" fill={fill}>
      {(query) => {
        const q = query.trim().toLowerCase()
        const filtered = !q
          ? values
          : values.filter((value) => {
              const display = catalogValueDisplayLabel(term.id, value)
              return (
                value.toLowerCase().includes(q) ||
                display.toLowerCase().includes(q)
              )
            })
        if (!filtered.length) {
          return (
            <li className="py-2 text-xs text-muted-foreground">No matches.</li>
          )
        }
        return filtered.map((value) => {
          const display = catalogValueDisplayLabel(term.id, value)
          const filter: UiFilter =
            term.id === 'matrix.profileSource'
              ? {
                  kind: 'custom',
                  id: `matrix.profileSource:${value}`,
                  label: `${title} = ${display}`,
                }
              : {
                  kind: 'alphanumeric',
                  id: term.id,
                  value,
                  label: `${title} = ${display}`,
                }
          const selected = activeKeys.has(filterKey(filter))
          return (
            <li key={value} className="min-w-0">
              <button
                type="button"
                disabled={selected}
                title={selected ? `${display} · in query` : display}
                className="block w-full min-w-0 rounded-sm px-1.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-muted/70 disabled:cursor-default disabled:opacity-50"
                onClick={() => selectValue(value)}
              >
                {display}
              </button>
            </li>
          )
        })
      }}
    </TermSearchList>
  )
}

function OntologyAccordionItem({
  group,
  activeFilters,
  onAddFilter,
  resourceName,
  fill,
}: {
  group: NamespaceScopeGroup
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  resourceName?: string
  fill: boolean
}) {
  const title = (group.namespaceType || 'unknown').toUpperCase()
  const detail = resourceName ?? group.namespaceLabel
  const chipCount = ontologyGroupChipCount(group)

  return (
    <Accordion.Item value={group.key} className={accordionItemClass(fill)}>
      <AccordionTriggerRow
        title={title}
        detail={detail}
        count={chipCount}
        countLabel={chipCount === 1 ? 'term' : 'terms'}
      />
      <Accordion.Panel className={accordionPanelClass(fill)}>
        <div className={cn(fill && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
          <OntologyTermPicker
            group={group}
            activeFilters={activeFilters}
            onAddFilter={onAddFilter}
            fill={fill}
          />
        </div>
      </Accordion.Panel>
    </Accordion.Item>
  )
}

function AlphanumericAccordionItem({
  term,
  activeFilters,
  onAddFilter,
  fill,
}: {
  term: FilteringTerm
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  fill: boolean
}) {
  const values = term.values ?? []
  if (!values.length) return null

  const title = term.label ?? term.id
  const detail = term.label && term.label !== term.id ? term.id : undefined

  return (
    <Accordion.Item value={term.id} className={accordionItemClass(fill)}>
      <AccordionTriggerRow
        title={title}
        detail={detail}
        count={values.length}
        countLabel={values.length === 1 ? 'value' : 'values'}
      />
      <Accordion.Panel className={accordionPanelClass(fill)}>
        <div className={cn(fill && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
          <AlphanumericTermPicker
            term={term}
            activeFilters={activeFilters}
            onAddFilter={onAddFilter}
            fill={fill}
          />
        </div>
      </Accordion.Panel>
    </Accordion.Item>
  )
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
  const fill = variant === 'sidebar'
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

  const defaultOpen =
    ontologyGroups[0]?.key ?? alphanumericTerms[0]?.id ?? customGroup?.key ?? undefined

  // Hooks must run before any early return (embedded loading/empty paths).
  const [openValue, setOpenValue] = useState<string[]>(() =>
    defaultOpen ? [defaultOpen] : []
  )
  const openSwitchRaf = useRef<number | null>(null)

  useEffect(() => {
    if (defaultOpen && openValue.length === 0) {
      setOpenValue([defaultOpen])
    }
  }, [defaultOpen, openValue.length])

  if (variant === 'embedded' && loading) {
    return <p className="text-xs text-muted-foreground">Loading terms…</p>
  }
  if (variant === 'embedded' && error) {
    return <p className="text-xs text-destructive">{error}</p>
  }

  const empty =
    ontologyGroups.length === 0 &&
    alphanumericTerms.length === 0 &&
    !customGroup

  if (empty) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No terms in this catalog.
      </p>
    )
  }

  function handleOpenChange(next: string[]) {
    if (!fill) {
      setOpenValue(next)
      return
    }

    const current = openValue[0]
    const incoming = next[0]

    // Switching sections: close first (instant), open on the next frame so the
    // lower panel cannot paint over the newly expanded upper panel.
    if (current && incoming && current !== incoming) {
      if (openSwitchRaf.current != null) {
        cancelAnimationFrame(openSwitchRaf.current)
      }
      setOpenValue([])
      openSwitchRaf.current = requestAnimationFrame(() => {
        openSwitchRaf.current = requestAnimationFrame(() => {
          openSwitchRaf.current = null
          setOpenValue([incoming])
        })
      })
      return
    }

    if (openSwitchRaf.current != null) {
      cancelAnimationFrame(openSwitchRaf.current)
      openSwitchRaf.current = null
    }
    setOpenValue(next)
  }

  return (
    <Accordion.Root
      multiple={false}
      value={openValue}
      onValueChange={handleOpenChange}
      className={cn(
        'w-full min-w-0',
        fill
          ? 'flex h-full min-h-0 flex-col'
          : 'border-t border-border'
      )}
    >
      {ontologyGroups.map((group) => (
        <OntologyAccordionItem
          key={group.key}
          group={group}
          activeFilters={activeFilters}
          onAddFilter={onAddFilter}
          resourceName={resourceByPrefix.get(group.namespaceType)?.name}
          fill={fill}
        />
      ))}
      {alphanumericTerms.map((term) => (
        <AlphanumericAccordionItem
          key={term.id}
          term={term}
          activeFilters={activeFilters}
          onAddFilter={onAddFilter}
          fill={fill}
        />
      ))}
      {customGroup && (
        <OntologyAccordionItem
          group={customGroup}
          activeFilters={activeFilters}
          onAddFilter={onAddFilter}
          fill={fill}
        />
      )}
    </Accordion.Root>
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
    <aside className="w-full min-w-0 shrink-0 lg:sticky lg:top-4 lg:w-72 xl:w-80">
      <div className="flex h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border bg-muted/20 px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Namespaces
          </h2>
          <div className="min-w-0 truncate" title={source}>
            <LensMutedEndpoints lines={[source]} />
          </div>
        </div>
        {loading && (
          <p className="px-3 py-3 text-xs text-muted-foreground">Loading…</p>
        )}
        {error && <p className="px-3 py-3 text-xs text-destructive">{error}</p>}
        {!loading && !error && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        )}
      </div>
    </aside>
  )
}
