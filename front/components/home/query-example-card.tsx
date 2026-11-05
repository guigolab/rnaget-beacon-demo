'use client'

import Link from 'next/link'
import { useState } from 'react'
import { MetaBadge } from '@/components/shared/detail/meta-badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  apiBase,
  curlFor,
  isAbortError,
  queryCollection,
} from '@/lib/beacon'
import { collectionQuery } from '@/lib/beacon/query'
import type { HomeQueryExample } from '@/lib/home-query-examples'
import { cn } from '@/lib/utils'

type RunState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ok'
      total?: number
      ids: string[]
    }
  | { status: 'error'; message: string }

function resultId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  for (const key of ['id', 'matrixId', 'featureId', 'biosampleId']) {
    const value = r[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function CurlBlock({
  method,
  path,
  body,
}: {
  method: string
  path: string
  body?: unknown
}) {
  const curl = curlFor({ method, path, body, at: '' }, apiBase())
  return (
    <div className="space-y-1.5">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground">
        {curl}
      </pre>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => void navigator.clipboard.writeText(curl)}
      >
        Copy curl
      </Button>
    </div>
  )
}

function RequestPreview({ example }: { example: HomeQueryExample }) {
  if (!example.request) return null
  const built = collectionQuery(example.request.path, example.request.opts)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetaBadge variant="accent">{built.method}</MetaBadge>
        <code className="break-all font-mono text-[11px] text-foreground">
          {built.path}
        </code>
      </div>
      {built.body != null && (
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {JSON.stringify(built.body, null, 2)}
        </pre>
      )}
      <CurlBlock method={built.method} path={built.path} body={built.body} />
    </div>
  )
}

type QueryExampleCardProps = {
  example: HomeQueryExample
}

export function QueryExampleCard({ example }: QueryExampleCardProps) {
  const [run, setRun] = useState<RunState>({ status: 'idle' })

  async function onRun() {
    if (!example.request) return
    setRun({ status: 'loading' })
    try {
      const page = await queryCollection<unknown>(
        example.request.path,
        example.request.opts
      )
      const ids = page.results
        .map(resultId)
        .filter((id): id is string => Boolean(id))
        .slice(0, 3)
      setRun({ status: 'ok', total: page.total, ids })
    } catch (err: unknown) {
      if (isAbortError(err)) return
      setRun({
        status: 'error',
        message: err instanceof Error ? err.message : 'Request failed',
      })
    }
  }

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{example.title}</h3>
          {example.href && (
            <Link
              href={example.href}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              {example.tab === 'explore' ? 'Open in Explore' : 'Open'}
              <span aria-hidden>→</span>
            </Link>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {example.blurb}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <RequestPreview example={example} />

        {example.underlying && example.underlying.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Underlying Beacon calls
            </p>
            {example.underlying.map((item) => {
              const built = collectionQuery(item.request.path, item.request.opts)
              return (
                <div key={item.label} className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground">{item.label}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MetaBadge variant="muted">{built.method}</MetaBadge>
                    <code className="break-all font-mono text-[11px] text-muted-foreground">
                      {built.path}
                    </code>
                  </div>
                  <CurlBlock
                    method={built.method}
                    path={built.path}
                    body={built.body}
                  />
                </div>
              )
            })}
          </div>
        )}

        {example.request && (
          <div className="mt-auto space-y-2 border-t border-border pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={run.status === 'loading'}
              onClick={() => void onRun()}
            >
              {run.status === 'loading' ? 'Running…' : 'Run'}
            </Button>
            {run.status === 'ok' && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {run.total != null
                    ? `${run.total.toLocaleString()} result${run.total === 1 ? '' : 's'}`
                    : 'Done'}
                </p>
                {run.ids.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {run.ids.map((id) => (
                      <li key={id}>
                        <MetaBadge variant="muted" title={id}>
                          <span className="max-w-[12rem] truncate font-mono">
                            {id}
                          </span>
                        </MetaBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {run.status === 'error' && (
              <p className="text-xs text-destructive">{run.message}</p>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
