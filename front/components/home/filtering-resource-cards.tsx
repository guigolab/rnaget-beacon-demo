import type { FilteringResource, FilteringTerm } from '@/lib/beacon/types'
import { countTermsForResourcePrefix } from '@/lib/scope-theme'
import { EndpointNote } from '@/components/ui-kit'

type FilteringResourceCardsProps = {
  resources: FilteringResource[]
  terms: FilteringTerm[]
}

export function FilteringResourceCards({ resources, terms }: FilteringResourceCardsProps) {
  if (resources.length === 0) return null

  const sorted = [...resources].sort((a, b) =>
    (a.nameSpacePrefix ?? a.id ?? '').localeCompare(b.nameSpacePrefix ?? b.id ?? '')
  )

  return (
    <section>
      <h2 className="text-sm font-medium">Ontology resources</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Registered namespaces referenced by filtering terms in this beacon.
      </p>
      <EndpointNote>GET /filtering_terms</EndpointNote>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((resource) => {
          const prefix = resource.nameSpacePrefix
          const termCount = countTermsForResourcePrefix(terms, prefix)
          const key = resource.id ?? prefix ?? resource.name ?? 'resource'

          return (
            <article
              key={key}
              className="rounded-lg border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                {prefix && (
                  <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
                    {prefix}
                  </span>
                )}
                {termCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {termCount} term{termCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <h3 className="mt-2 text-sm font-medium leading-snug">
                {resource.name ?? prefix ?? 'Resource'}
              </h3>
              {resource.id && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">{resource.id}</p>
              )}

            </article>
          )
        })}
      </div>
    </section>
  )
}
