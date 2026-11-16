'use client'

import { Popover } from '@base-ui/react/popover'
import type { FilteringTerm } from '@/lib/beacon/types'
import { filterTypeChipStyle, type FilterTermType } from '@/lib/filter-type-theme'
import { SCOPE_LEGEND, type NamespaceScopeGroup } from '@/lib/scope-theme'

function scopeShortLabel(scope: NamespaceScopeGroup['scope']): string {
  return SCOPE_LEGEND.find((s) => s.scope === scope)?.label ?? scope
}

/** Facet / alphanumeric groups hold alphanumeric terms; every other namespace is an ontology. */
export function namespaceTermType(group: NamespaceScopeGroup): FilterTermType {
  return group.namespaceType === 'facet' || group.namespaceType === 'alphanumeric'
    ? 'alphanumeric'
    : 'ontology'
}

function TermRow({ term }: { term: FilteringTerm }) {
  return (
    <li className="border-b border-border py-1.5 last:border-0">
      <p className="text-xs font-medium text-foreground">{term.label ?? term.id}</p>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{term.id}</p>
      {term.values && term.values.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {term.values.slice(0, 24).map((value) => (
            <li
              key={value}
              className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {value}
            </li>
          ))}
          {term.values.length > 24 && (
            <li className="px-1 text-[10px] text-muted-foreground">
              +{term.values.length - 24}
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

/** Compact namespace chip aligned with MetaBadge sizing. */
export function NamespaceScopeChip({ group }: { group: NamespaceScopeGroup }) {
  const termType = namespaceTermType(group)
  const alphanumeric = termType === 'alphanumeric'
  const typeStyle = filterTypeChipStyle(termType)
  const prefix = alphanumeric ? group.namespaceLabel : group.namespaceType
  const hasTerms = group.count > 0 && group.terms.length > 0
  const titleCount = hasTerms
    ? `${group.count} term${group.count === 1 ? '' : 's'}`
    : 'resource · no catalogued terms'

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        title={`${group.namespaceLabel} · ${scopeShortLabel(group.scope)} · ${titleCount}`}
        className={
          hasTerms
            ? 'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            : 'inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium leading-none text-muted-foreground transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
        }
        style={
          hasTerms
            ? {
                ...typeStyle,
                borderWidth: 1,
                borderStyle: 'solid',
              }
            : undefined
        }
      >
        <span className={alphanumeric ? 'truncate' : 'truncate font-mono'}>{prefix}</span>
        {hasTerms && (
          <span className="tabular-nums text-[9px] opacity-80">{group.count}</span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup className="z-50 w-[min(100vw-2rem,22rem)] rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg outline-none">
            <div className="border-b border-border px-3 py-2.5">
              <Popover.Title className="text-sm font-semibold">
                {group.namespaceLabel}
              </Popover.Title>
              <Popover.Description className="mt-0.5 text-[11px] text-muted-foreground">
                {scopeShortLabel(group.scope)}
                {hasTerms
                  ? ` · ${group.count} term${group.count === 1 ? '' : 's'}`
                  : ' · resource namespace'}
              </Popover.Description>
            </div>
            {hasTerms && alphanumeric && (
              <p className="border-b border-border bg-muted/30 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                Alphanumeric filter: <code className="font-mono">id</code> +{' '}
                <code className="font-mono">operator</code> +{' '}
                <code className="font-mono">value</code> (for example{' '}
                <code className="font-mono">=</code> or{' '}
                <code className="font-mono">&gt;=</code>). Values below are the
                precomputed set offered in the UI.
              </p>
            )}
            {hasTerms ? (
              <ul className="max-h-72 overflow-y-auto px-3 py-1.5">
                {group.terms.map((term) => (
                  <TermRow key={`${term.id}-${term.type}`} term={term} />
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">
                No catalogued filtering terms. Type a CURIE or id in the query bar
                (for example {prefix}:…).
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
