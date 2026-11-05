'use client'

import { useEffect, useMemo, useState } from 'react'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import { SimplePager } from '@/components/shared/simple-pager'
import { usePagedList } from '@/hooks/use-paged-list'
import type { BeaconMap, BeaconMapEndpointSet } from '@/lib/beacon'
import { cn } from '@/lib/utils'
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

const ROWS_PAGE_SIZE = 6

type MapRow = {
  key: string
  label: string
  path: string
  badge?: string
  methodHint: string
}

function rowsForSet(set: BeaconMapEndpointSet): MapRow[] {
  const rows: MapRow[] = []
  const rootPath = urlToPath(set.rootUrl)
  const singlePath = urlToPath(set.singleEntryUrl)
  const filteringPath = urlToPath(set.filteringTermsUrl)
  if (rootPath) {
    rows.push({
      key: `collection-${rootPath}`,
      label: 'Collection',
      path: rootPath,
      methodHint: `GET or POST ${rootPath}`,
    })
  }
  if (singlePath) {
    rows.push({
      key: `single-${singlePath}`,
      label: 'Single',
      path: singlePath,
      methodHint: `GET ${singlePath}`,
    })
  }
  if (filteringPath) {
    rows.push({
      key: `filters-${filteringPath}`,
      label: 'Filters',
      path: filteringPath,
      methodHint: `GET ${filteringPath}`,
    })
  }
  const nested = Object.entries(set.endpoints ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  for (const [, endpoint] of nested) {
    const path = urlToPath(endpoint.url)
    if (!path) continue
    rows.push({
      key: `nested-${path}`,
      label: 'Nested',
      path,
      badge: endpoint.returnedEntryType,
      methodHint: `GET or POST ${path}`,
    })
  }
  return rows
}

type BeaconMapSectionProps = {
  map: BeaconMap | null
}

export function BeaconMapSection({ map }: BeaconMapSectionProps) {
  const sets = useMemo(() => {
    if (!map) return [] as Array<[string, BeaconMapEndpointSet]>
    return Object.entries(map.endpointSets ?? {}).sort(([a], [b]) => {
      const ai = SET_ORDER[a] ?? 50
      const bi = SET_ORDER[b] ?? 50
      if (ai !== bi) return ai - bi
      return a.localeCompare(b)
    })
  }, [map])

  const [activeKey, setActiveKey] = useState(sets[0]?.[0] ?? '')
  useEffect(() => {
    if (!sets.some(([key]) => key === activeKey)) {
      setActiveKey(sets[0]?.[0] ?? '')
    }
  }, [sets, activeKey])

  const active = sets.find(([key]) => key === activeKey) ?? sets[0]
  const setKey = active?.[0] ?? ''
  const set = active?.[1]
  const entryType = set?.entryType ?? setKey
  const scope = entryTypeScope(entryType)
  const colors = scopeCssVars(scope)
  const rows = useMemo(() => (set ? rowsForSet(set) : []), [set])
  const pager = usePagedList(rows, ROWS_PAGE_SIZE)
  useEffect(() => {
    pager.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on set change
  }, [setKey])

  if (!map) return null

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
        <>
          <div className="flex flex-wrap gap-1 border-b border-border pb-2">
            {sets.map(([key, endpointSet]) => {
              const label = endpointSet.entryType ?? key
              const activeTab = key === setKey
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveKey(key)}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    activeTab
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <article className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: colors.border }}
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-2.5 pl-5">
              <h3 className="text-sm font-semibold text-foreground">{entryType}</h3>
              <MetaBadge variant="muted">{setKey}</MetaBadge>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-3 pl-5 text-sm text-muted-foreground">
                No paths advertised.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-border pl-1">
                  {pager.items.map((row) => (
                    <li
                      key={row.key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 pl-5"
                    >
                      <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {row.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <LensMutedEndpoints lines={[row.methodHint]} />
                      </div>
                      {row.badge && (
                        <MetaBadge variant="accent">{row.badge}</MetaBadge>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="border-t border-border px-4 py-2 pl-5">
                  <SimplePager pager={pager} label="Endpoints" />
                </div>
              </>
            )}
          </article>
        </>
      )}
    </section>
  )
}
