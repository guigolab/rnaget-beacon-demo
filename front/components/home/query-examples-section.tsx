'use client'

import { useEffect, useMemo, useState } from 'react'
import { QueryExampleCard } from '@/components/home/query-example-card'
import { LensMutedEndpoints } from '@/components/shared/lens-muted-endpoints'
import {
  FALLBACK_MATRIX_IDS,
  isAbortError,
  listMatrices,
  type FilteringTerm,
} from '@/lib/beacon'
import {
  buildHomeQueryExamples,
  examplesForTab,
  HOME_EXAMPLE_TABS,
  type HomeExampleTab,
} from '@/lib/home-query-examples'
import { cn } from '@/lib/utils'

type QueryExamplesSectionProps = {
  terms: FilteringTerm[]
}

export function QueryExamplesSection({ terms }: QueryExamplesSectionProps) {
  const [tab, setTab] = useState<HomeExampleTab>('matrix')
  const [matrixIds, setMatrixIds] = useState<string[]>(FALLBACK_MATRIX_IDS)

  useEffect(() => {
    const controller = new AbortController()
    listMatrices(0, 50, { granularity: 'record', signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return
        const ids = page.results
          .map((m) => m.matrixId)
          .filter((id): id is string => Boolean(id?.trim()))
        if (ids.length) setMatrixIds(ids)
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
      })
    return () => controller.abort()
  }, [])

  const examples = useMemo(
    () => buildHomeQueryExamples({ terms, matrixIds }),
    [terms, matrixIds]
  )
  const visible = examplesForTab(examples, tab)

  return (
    <section id="queries" className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Query examples
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Runnable Beacon requests against the four demo models, plus Explore
          deep links that compose those same filters.
        </p>
        <div className="mt-1">
          <LensMutedEndpoints
            lines={[
              'GET or POST /matrices',
              'GET or POST /features',
              'GET or POST /biosamples',
              'POST /matrices/{id}/expression_values',
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {HOME_EXAMPLE_TABS.map((item) => {
          const active = item.id === tab
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No examples for this tab.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((example) => (
            <QueryExampleCard key={example.id} example={example} />
          ))}
        </div>
      )}
    </section>
  )
}
