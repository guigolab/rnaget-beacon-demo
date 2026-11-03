'use client'

import { Popover } from '@base-ui/react/popover'
import { useCallback, useState } from 'react'
import { apiBase } from '@/lib/beacon'
import { cn } from '@/lib/utils'

type ParsedEndpoint = {
  method: string
  path: string
}

/** Expand compact labels like `GET or POST /features` into inspectable lines. */
export function expandEndpointLines(lines: string[]): string[] {
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const alt = line.match(/^(GET)\s+or\s+(POST)\s+(\/\S*)$/i)
    if (alt) {
      const path = alt[3] || '/'
      out.push(`${alt[1].toUpperCase()} ${path}`)
      out.push(`${alt[2].toUpperCase()} ${path}`)
      continue
    }
    out.push(line)
  }
  return out
}

function parseEndpointLine(line: string): ParsedEndpoint | null {
  const match = line.trim().match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)$/i)
  if (!match) return null
  return {
    method: match[1].toUpperCase(),
    path: match[2] || '/',
  }
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; statusCode: number; body: unknown }
  | { status: 'error'; message: string; statusCode?: number; body?: unknown }

function EndpointInspectLink({ line }: { line: string }) {
  const parsed = parseEndpointLine(line)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<FetchState>({ status: 'idle' })

  const requestUrl = parsed ? `${apiBase()}${parsed.path}` : null
  const hasPlaceholder = Boolean(parsed?.path.includes('{'))

  const load = useCallback(async () => {
    if (!parsed || !requestUrl) return
    if (hasPlaceholder) {
      setState({
        status: 'error',
        message: 'Path still contains a placeholder (for example {id}); substitute a real id to fetch.',
      })
      return
    }
    setState({ status: 'loading' })
    try {
      const response = await fetch(requestUrl, {
        method: parsed.method,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(parsed.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: parsed.method !== 'GET' ? '{}' : undefined,
      })
      const text = await response.text()
      let body: unknown = null
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          body = text
        }
      }
      if (!response.ok) {
        setState({
          status: 'error',
          message: `Request failed (${response.status})`,
          statusCode: response.status,
          body,
        })
        return
      }
      setState({ status: 'ok', statusCode: response.status, body })
    } catch (err: unknown) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Request failed',
      })
    }
  }, [hasPlaceholder, parsed, requestUrl])

  if (!parsed || !requestUrl) {
    return <span>{line}</span>
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void load()
      }}
    >
      <Popover.Trigger
        type="button"
        className="rounded-sm text-[11px] leading-relaxed text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {line}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup className="z-50 w-[min(100vw-2rem,28rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none">
            <div className="border-b border-border px-3 py-2.5">
              <Popover.Title className="text-sm font-semibold">{line}</Popover.Title>
              <Popover.Description className="mt-0.5 text-[11px] text-muted-foreground">
                Request and JSON response
              </Popover.Description>
            </div>
            <div className="space-y-3 px-3 py-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Request
                </p>
                <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
                  {`${parsed.method} ${requestUrl}`}
                  {parsed.method !== 'GET' ? '\nContent-Type: application/json\n{}' : ''}
                </pre>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Response
                  {state.status === 'ok' && (
                    <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/80">
                      · {state.statusCode}
                    </span>
                  )}
                  {state.status === 'error' && state.statusCode != null && (
                    <span className="ml-1.5 normal-case tracking-normal text-destructive">
                      · {state.statusCode}
                    </span>
                  )}
                </p>
                {state.status === 'idle' || state.status === 'loading' ? (
                  <p className="mt-1 text-xs text-muted-foreground">Loading…</p>
                ) : state.status === 'error' && state.body == null ? (
                  <p className="mt-1 text-xs text-destructive">{state.message}</p>
                ) : (
                  <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
                    {JSON.stringify(
                      state.status === 'ok' ? state.body : state.body ?? { error: state.message },
                      null,
                      2
                    )}
                  </pre>
                )}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

type LensMutedEndpointsProps = {
  lines: string[]
  className?: string
}

export function LensMutedEndpoints({ lines, className }: LensMutedEndpointsProps) {
  const expanded = expandEndpointLines(lines)
  if (expanded.length === 0) return null

  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed text-muted-foreground/80',
        className
      )}
    >
      {expanded.map((line, index) => (
        <span key={`${line}-${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 && <span aria-hidden>·</span>}
          <EndpointInspectLink line={line} />
        </span>
      ))}
    </p>
  )
}
