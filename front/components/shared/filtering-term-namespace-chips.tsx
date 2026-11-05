'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Popover } from '@base-ui/react/popover'
import { ChevronDown } from 'lucide-react'
import type { UiFilter } from '@/lib/beacon'
import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'
import {
  AlphanumericTermPicker,
  OntologyTermPicker,
  ontologyGroupChipCount,
} from '@/components/shared/filtering-term-browser'
import {
  browsableTerms,
  isHiddenFilteringTerm,
} from '@/lib/lens-catalog'
import {
  customFacetAsGroup,
  filterTypeChipStyle,
  groupCustomTermsForChips,
  type FilterTermType,
} from '@/lib/filter-type-theme'
import {
  groupTermsByNamespaceScope,
  type BeaconScope,
  type NamespaceScopeGroup,
} from '@/lib/scope-theme'
import { cn } from '@/lib/utils'

type FilteringTermNamespaceChipsProps = {
  scope: BeaconScope
  terms: FilteringTerm[]
  resources: FilteringResource[]
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  loading?: boolean
  error?: string
  /** Hide namespaces / alphanumeric facets with fewer than two selectable values. */
  hideSingleValueTerms?: boolean
}

function NamespaceChipPopover({
  label,
  count,
  open,
  onOpenChange,
  monoLabel = false,
  termType,
  children,
}: {
  label: string
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
  monoLabel?: boolean
  termType: FilterTermType
  children: ReactNode
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        type="button"
        aria-expanded={open}
        style={filterTypeChipStyle(termType)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
          'hover:brightness-[0.98]',
          open && 'ring-1 ring-foreground/15'
        )}
      >
        <span className={cn(monoLabel && 'font-mono tracking-wide')}>{label}</span>
        <span className="tabular-nums opacity-70">{count}</span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 opacity-70 transition-transform',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-[200]">
          <Popover.Popup className="z-[200] w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none">
            <div className="border-b border-border px-3 py-2">
              <Popover.Title className="text-xs font-semibold text-foreground">
                {label}
              </Popover.Title>
            </div>
            <div className="max-h-[min(70vh,20rem)] overflow-hidden">{children}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function FilteringTermNamespaceChips({
  scope,
  terms,
  resources,
  activeFilters,
  onAddFilter,
  loading = false,
  error = '',
  hideSingleValueTerms = false,
}: FilteringTermNamespaceChipsProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const minChoices = hideSingleValueTerms ? 2 : 1

  const visible = useMemo(() => browsableTerms(terms), [terms])

  const ontologyGroups = useMemo(
    () =>
      groupTermsByNamespaceScope(visible).filter(
        (group) =>
          group.scope === scope &&
          group.namespaceType !== 'alphanumeric' &&
          group.namespaceType !== 'custom' &&
          ontologyGroupChipCount(group) >= minChoices
      ),
    [minChoices, scope, visible]
  )

  const alphanumericTerms = useMemo(
    () =>
      visible.filter(
        (term) =>
          term.type === 'alphanumeric' &&
          (term.scopes?.includes(scope) ?? false) &&
          (term.values?.length ?? 0) >= minChoices
      ),
    [minChoices, scope, visible]
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

  const customFacets = useMemo(() => {
    return groupCustomTermsForChips(scope, customTerms).filter((facet) => {
      const group = customFacetAsGroup(scope, facet)
      return ontologyGroupChipCount(group) >= minChoices
    })
  }, [customTerms, minChoices, scope])

  const resourceByPrefix = useMemo(() => {
    const map = new Map<string, FilteringResource>()
    for (const resource of resources) {
      if (resource.nameSpacePrefix) map.set(resource.nameSpacePrefix, resource)
    }
    return map
  }, [resources])

  function addAndClose(filter: UiFilter) {
    onAddFilter(filter)
    setOpenKey(null)
  }

  if (loading) {
    return <p className="text-[11px] text-muted-foreground">Loading terms…</p>
  }
  if (error) {
    return <p className="text-[11px] text-destructive">{error}</p>
  }

  const empty =
    ontologyGroups.length === 0 &&
    alphanumericTerms.length === 0 &&
    customFacets.length === 0

  if (empty) {
    return (
      <p className="text-[11px] text-muted-foreground">No terms in this catalog.</p>
    )
  }

  function ontologyLabel(group: NamespaceScopeGroup): string {
    return (group.namespaceType || 'unknown').toUpperCase()
  }

  function ontologyTitle(group: NamespaceScopeGroup): string {
    return resourceByPrefix.get(group.namespaceType)?.name ?? group.namespaceLabel
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ontologyGroups.map((group) => {
        const key = group.key
        const label = ontologyLabel(group)
        const count = ontologyGroupChipCount(group)
        return (
          <NamespaceChipPopover
            key={key}
            label={label}
            count={count}
            monoLabel
            termType="ontology"
            open={openKey === key}
            onOpenChange={(next) => setOpenKey(next ? key : null)}
          >
            <div className="px-0 pb-1 pt-0">
              <p className="px-3 pt-2 text-[10px] text-muted-foreground">
                {ontologyTitle(group)}
              </p>
              <OntologyTermPicker
                group={group}
                activeFilters={activeFilters}
                onAddFilter={addAndClose}
              />
            </div>
          </NamespaceChipPopover>
        )
      })}
      {alphanumericTerms.map((term) => {
        const key = term.id
        const label = term.label ?? term.id
        const count = term.values?.length ?? 0
        return (
          <NamespaceChipPopover
            key={key}
            label={label}
            count={count}
            termType="alphanumeric"
            open={openKey === key}
            onOpenChange={(next) => setOpenKey(next ? key : null)}
          >
            <AlphanumericTermPicker
              term={term}
              activeFilters={activeFilters}
              onAddFilter={addAndClose}
            />
          </NamespaceChipPopover>
        )
      })}
      {customFacets.map((facet) => {
        const group = customFacetAsGroup(scope, facet)
        const count = ontologyGroupChipCount(group)
        return (
          <NamespaceChipPopover
            key={facet.key}
            label={facet.label}
            count={count}
            termType="custom"
            open={openKey === facet.key}
            onOpenChange={(next) => setOpenKey(next ? facet.key : null)}
          >
            <OntologyTermPicker
              group={group}
              activeFilters={activeFilters}
              onAddFilter={addAndClose}
            />
          </NamespaceChipPopover>
        )
      })}
    </div>
  )
}
