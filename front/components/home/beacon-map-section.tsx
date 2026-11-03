import { MetaBadge } from '@/components/shared/detail/meta-badge'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import type { BeaconMap, BeaconMapEndpointSet } from '@/lib/beacon'
import { entryTypeScope, scopeCssVars } from '@/lib/scope-theme'

/** Decode %7Bid%7D-style segments so placeholders render as {id}. */
function decodePathPlaceholders(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
  }
}

function urlToPath(url: string | undefined): string | null {
  if (!url) return null
  let path: string
  try {
    path = url.startsWith('/') ? url : new URL(url).pathname
  } catch {
    const idx = url.indexOf('/', url.indexOf('://') + 3)
    path = idx >= 0 ? url.slice(idx) : url
  }
  return decodePathPlaceholders(path)
}

const SET_ORDER: Record<string, number> = {
  featureEndpoints: 0,
  biosampleEndpoints: 1,
  matrixEndpoints: 2,
}

function EndpointSetCard({
  setKey,
  set,
}: {
  setKey: string
  set: BeaconMapEndpointSet
}) {
  const entryType = set.entryType ?? setKey
  const scope = entryTypeScope(entryType)
  const colors = scopeCssVars(scope)
  const rootPath = urlToPath(set.rootUrl)
  const singlePath = urlToPath(set.singleEntryUrl)
  const filteringPath = urlToPath(set.filteringTermsUrl)
  const nested = Object.entries(set.endpoints ?? {}).sort(([a], [b]) => a.localeCompare(b))

  const rows: Array<{ label: string; path: string; badge?: string }> = []
  if (rootPath) rows.push({ label: 'Collection', path: rootPath })
  if (singlePath) rows.push({ label: 'Single', path: singlePath })
  if (filteringPath) rows.push({ label: 'Filters', path: filteringPath })
  for (const [, endpoint] of nested) {
    const path = urlToPath(endpoint.url)
    if (!path) continue
    rows.push({
      label: 'Nested',
      path,
      badge: endpoint.returnedEntryType,
    })
  }

  return (
    <article className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: colors.border }}
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-2.5 pl-5">
        <h3 className="text-sm font-semibold text-foreground">{entryType}</h3>
        <MetaBadge variant="muted">{setKey}</MetaBadge>
      </div>
      <ul className="divide-y divide-border pl-1">
        {rows.length === 0 ? (
          <li className="px-4 py-3 pl-5 text-sm text-muted-foreground">No paths advertised.</li>
        ) : (
          rows.map((row) => (
            <li
              key={`${row.label}-${row.path}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 pl-5"
            >
              <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
              </span>
              <code className="min-w-0 flex-1 break-words rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-xs font-medium leading-relaxed tracking-tight text-foreground">
                {row.path}
              </code>
              {row.badge && <MetaBadge variant="accent">{row.badge}</MetaBadge>}
            </li>
          ))
        )}
      </ul>
    </article>
  )
}

type BeaconMapSectionProps = {
  map: BeaconMap | null
}

export function BeaconMapSection({ map }: BeaconMapSectionProps) {
  if (!map) return null

  const sets = Object.entries(map.endpointSets ?? {}).sort(([a], [b]) => {
    const ai = SET_ORDER[a] ?? 50
    const bi = SET_ORDER[b] ?? 50
    if (ai !== bi) return ai - bi
    return a.localeCompare(b)
  })

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Endpoint map
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paths advertised for each entry type and nested lookup.
        </p>
        <div className="mt-1">
          <LensMutedEndpoints lines={['GET /map']} />
        </div>
      </div>

      {sets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No endpoint sets returned.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sets.map(([key, set]) => (
            <EndpointSetCard key={key} setKey={key} set={set} />
          ))}
        </div>
      )}
    </section>
  )
}
