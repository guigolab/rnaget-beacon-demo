import Link from 'next/link'
import type { EntryTypeInfo } from '@/lib/beacon/types'
import { entryTypeScope, scopeCssVars } from '@/lib/scope-theme'

const ROUTES: Record<string, string> = {
  matrix: '/matrices/',
  feature: '/features/',
  biosample: '/biosamples/',
}

const NESTED_MATRIX_TYPES = new Set(['expressionValue', 'expressionSummary'])

type EntryTypeCardsProps = {
  entryTypes: EntryTypeInfo[]
}

export function EntryTypeCards({ entryTypes }: EntryTypeCardsProps) {
  const sorted = [...entryTypes].sort((a, b) =>
    (a.id ?? '').localeCompare(b.id ?? '')
  )

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((entry) => {
        const id = entry.id ?? ''
        const scope = entryTypeScope(id)
        const colors = scopeCssVars(scope)
        const href = ROUTES[id]
        const nested = NESTED_MATRIX_TYPES.has(id)

        const inner = (
          <>
            <div
              className="absolute inset-y-0 left-0 w-1 rounded-l-lg"
              style={{ backgroundColor: colors.border }}
              aria-hidden
            />
            <div className="pl-3">
              <h3 className="text-base font-semibold text-foreground">
                {entry.name || id}
              </h3>
              {entry.description && (
                <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>
              )}
              <p className="mt-2 font-mono text-xs text-muted-foreground">{id}</p>
              {entry.partOfSpecification && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.partOfSpecification}
                </p>
              )}
              {nested && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Accessed via matrix endpoints
                </p>
              )}
              {href && !nested && (
                <p className="mt-2 text-xs font-medium text-primary">Browse →</p>
              )}
            </div>
          </>
        )

        const cardClass =
          'relative overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md hover:border-border/80'

        if (href && !nested) {
          return (
            <Link key={id} href={href} className={`${cardClass} block`}>
              {inner}
            </Link>
          )
        }

        return (
          <article key={id} className={cardClass}>
            {inner}
          </article>
        )
      })}
    </div>
  )
}
