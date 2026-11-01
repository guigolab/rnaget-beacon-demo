'use client'

import { Popover } from '@base-ui/react/popover'
import type { FilteringTerm } from '@/lib/beacon/types'
import {
  SCOPE_LEGEND,
  groupTermsByNamespaceScope,
  scopeChipStyle,
  scopeCssVars,
  type NamespaceScopeGroup,
} from '@/lib/scope-theme'
import { ScopeLegend } from '@/components/home/scope-legend'
import { EndpointNote } from '@/components/ui-kit'

type FilteringNamespaceChipsProps = {
  terms: FilteringTerm[]
}

function scopeShortLabel(scope: NamespaceScopeGroup['scope']): string {
  return SCOPE_LEGEND.find((s) => s.scope === scope)?.label ?? scope
}

function TermRow({ term }: { term: FilteringTerm }) {
  return (
    <li className="border-b border-border py-2 last:border-0">
      <p className="text-sm font-medium text-foreground">{term.label ?? term.id}</p>
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{term.id}</p>
      {term.type && (
        <p className="text-xs text-muted-foreground">Type: {term.type}</p>
      )}
      {term.values && term.values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {term.values.map((value) => (
            <li
              key={value}
              className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
            >
              {value}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function NamespaceScopeChip({ group }: { group: NamespaceScopeGroup }) {
  const scopeStyle = scopeChipStyle(group.scope)
  const accent = scopeCssVars(group.scope)

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        className="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        style={{
          ...scopeStyle,
          borderWidth: 1,
          borderStyle: 'solid',
        }}
      >
        <span className="truncate font-medium">{group.namespaceLabel}</span>
        <span
          className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            backgroundColor: accent.bg,
            borderColor: accent.border,
            color: accent.text,
          }}
        >
          {scopeShortLabel(group.scope)}
        </span>
        <span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
          {group.count}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup className="z-50 w-[min(100vw-2rem,24rem)] rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg outline-none">
            <div className="border-b border-border px-4 py-3">
              <Popover.Title className="text-sm font-semibold">
                {group.namespaceLabel}
              </Popover.Title>
              <Popover.Description className="mt-0.5 text-xs text-muted-foreground">
                Scope: {scopeShortLabel(group.scope)} · {group.count} term
                {group.count === 1 ? '' : 's'} · {group.valueCount} value
                {group.valueCount === 1 ? '' : 's'}
              </Popover.Description>
            </div>
            <ul className="max-h-80 overflow-y-auto px-4 py-2">
              {group.terms.map((term) => (
                <TermRow key={`${term.id}-${term.type}`} term={term} />
              ))}
            </ul>
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {group.count} filtering term{group.count === 1 ? '' : 's'} in this group
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function FilteringNamespaceChips({ terms }: FilteringNamespaceChipsProps) {
  const groups = groupTermsByNamespaceScope(terms)
  if (groups.length === 0) return null

  return (
    <section>
      <h2 className="text-sm font-medium">Filtering terms by namespace & scope</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each chip is one namespace × scope pair. Click to inspect term labels and facet values.
      </p>
      <ScopeLegend className="mt-3" compact />
      <EndpointNote>GET /filtering_terms</EndpointNote>
      <div className="mt-4 flex flex-wrap gap-2">
        {groups.map((group) => (
          <NamespaceScopeChip key={group.key} group={group} />
        ))}
      </div>
    </section>
  )
}
