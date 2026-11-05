'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { NamespaceScopeChip } from '@/components/home/namespace-scope-chip'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import { buttonVariants } from '@/components/ui/button'
import type {
  EntryTypeInfo,
  FilteringResource,
  FilteringTerm,
} from '@/lib/beacon/types'
import { cn } from '@/lib/utils'
import {
  entryTypeScope,
  groupHomeNamespaces,
  scopeCssVars,
  type BeaconScope,
  type NamespaceScopeGroup,
} from '@/lib/scope-theme'

const ROUTES: Record<string, string> = {
  feature: '/explore/',
  biosample: '/explore/',
  matrix: '/matrices/',
}

const BROWSE_LABEL: Record<string, string> = {
  feature: 'Explore genes × tissues',
  biosample: 'Explore by sample',
  matrix: 'Browse matrices',
}

const ENTRY_ORDER: Record<string, number> = {
  feature: 0,
  biosample: 1,
  matrix: 2,
  expressionValue: 3,
}

const ROOT_ENTRY_TYPES = new Set(['biosample', 'feature', 'matrix'])
const NESTED_MATRIX_TYPES = new Set(['expressionValue'])

type EntryTypeCardsProps = {
  entryTypes: EntryTypeInfo[]
  terms: FilteringTerm[]
  resources?: FilteringResource[]
}

function EntryAccent({ entryId }: { entryId: string }) {
  const scope = entryTypeScope(entryId)
  const colors = scopeCssVars(scope)
  return (
    <div
      className="absolute inset-y-0 left-0 w-1"
      style={{ backgroundColor: colors.border }}
      aria-hidden
    />
  )
}

/** One version string — prefer partOfSpecification over schemaVersion. */
function entryVersionLabel(entry: EntryTypeInfo): string | undefined {
  const part = entry.partOfSpecification?.trim()
  if (part) return part
  const schema = entry.defaultSchema?.schemaVersion?.trim()
  return schema || undefined
}

function entryTypeChip(entry: EntryTypeInfo): { label: string; title?: string } | null {
  const ontology = entry.ontologyTermForThisType
  if (ontology?.label) {
    return { label: ontology.label, title: ontology.id }
  }
  if (entry.id) return { label: entry.id }
  return null
}

export function EntryTypeCards({
  entryTypes,
  terms,
  resources = [],
}: EntryTypeCardsProps) {
  const sorted = useMemo(
    () =>
      [...entryTypes].sort((a, b) => {
        const ai = ENTRY_ORDER[a.id ?? ''] ?? 50
        const bi = ENTRY_ORDER[b.id ?? ''] ?? 50
        if (ai !== bi) return ai - bi
        return (a.id ?? '').localeCompare(b.id ?? '')
      }),
    [entryTypes]
  )

  const groupsByScope = useMemo(() => {
    return groupHomeNamespaces(terms, resources).reduce(
      (acc, group) => {
        const list = acc.get(group.scope) ?? []
        list.push(group)
        acc.set(group.scope, list)
        return acc
      },
      new Map<BeaconScope, NamespaceScopeGroup[]>()
    )
  }, [terms, resources])

  return (
    <section id="entities" className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Entry types &amp; filtering terms
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Catalogued Beacon entry types with filtering-term namespaces for each
          root scope.
        </p>
        <div className="mt-1">
          <LensMutedEndpoints lines={['GET /entry_types', 'GET /filtering_terms']} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((entry) => {
          const id = entry.id ?? ''
          const href = ROUTES[id]
          const nested = NESTED_MATRIX_TYPES.has(id)
          const root = ROOT_ENTRY_TYPES.has(id)
          const scope = entryTypeScope(id)
          const chips = root ? (groupsByScope.get(scope) ?? []) : []
          const typeChip = entryTypeChip(entry)
          const version = entryVersionLabel(entry)
          const browseLabel = BROWSE_LABEL[id] ?? 'Browse'

          return (
            <article
              key={id}
              className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
            >
              <EntryAccent entryId={id} />

              <div className="border-b border-border bg-muted/20 px-4 py-3 pl-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {entry.name || id}
                  </h3>
                  {typeChip && (
                    <MetaBadge variant="accent" title={typeChip.title}>
                      {typeChip.label}
                    </MetaBadge>
                  )}
                </div>
                {version && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{version}</p>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-3 px-4 py-3 pl-5">
                {entry.description && (
                  <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {entry.description}
                  </p>
                )}

                {root && chips.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Filtering terms{' '}
                      <span className="normal-case tracking-normal">({scope})</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {chips.map((group) => (
                        <NamespaceScopeChip key={group.key} group={group} />
                      ))}
                    </div>
                  </div>
                )}

                {nested && (
                  <p className="text-[11px] text-muted-foreground">
                    Nested only — reached via{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                      /matrices/&#123;id&#125;/expression_values
                    </code>
                  </p>
                )}

                {href && !nested && (
                  <div className="mt-auto flex justify-end pt-1">
                    <Link
                      href={href}
                      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                    >
                      {browseLabel}
                      <span aria-hidden>→</span>
                    </Link>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
