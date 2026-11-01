import type { FilteringResource, OntologyTerm } from '@/lib/beacon/types'
import { curieHref } from '@/lib/beacon/facts'
import { MetaBadge } from '@/components/shared/detail/meta-badge'

function termLabel(term: OntologyTerm | string): string {
  if (typeof term === 'string') return term
  return term.label?.trim() || term.id || '—'
}

function termId(term: OntologyTerm | string): string | undefined {
  if (typeof term === 'string') return term.includes(':') ? term : undefined
  return term.id
}

export function OntologyTermBadges({
  terms,
  resources = [],
  variant = 'default',
}: {
  terms: Array<OntologyTerm | string>
  resources?: FilteringResource[]
  variant?: 'default' | 'accent' | 'muted'
}) {
  if (!terms.length) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((term) => {
        const id = termId(term)
        const label = termLabel(term)
        const href = id ? curieHref(resources, id) : undefined
        const badge = (
          <MetaBadge variant={variant} title={id}>
            {label}
          </MetaBadge>
        )
        if (href) {
          return (
            <a
              key={id ?? label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-90"
            >
              {badge}
            </a>
          )
        }
        return <span key={id ?? label}>{badge}</span>
      })}
    </div>
  )
}
