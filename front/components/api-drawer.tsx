'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import {
  apiBase,
  curlFor,
  getRecentBeaconCalls,
  subscribeBeaconCalls,
  summarizeCall,
  type CallChip,
  type RecordedCall,
} from '@/lib/beacon'
import { filterTypeChipStyle } from '@/lib/filter-type-theme'
import { cn } from '@/lib/utils'

const CHIP_BASE =
  'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none'

const METHOD_STYLES: Record<'GET' | 'POST', string> = {
  GET: 'border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  POST: 'border-sky-600/40 bg-sky-500/15 text-sky-800 dark:text-sky-300',
}

function MethodChip({ method }: { method: 'GET' | 'POST' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none',
        METHOD_STYLES[method]
      )}
    >
      {method}
    </span>
  )
}

function chipStyle(kind: CallChip['kind']): CSSProperties | undefined {
  if (kind === 'ontology' || kind === 'alphanumeric') return filterTypeChipStyle(kind)
  return undefined
}

const CHIP_CLASS: Record<CallChip['kind'], string> = {
  ontology: '',
  alphanumeric: '',
  pagination: 'border-border bg-muted/60 text-muted-foreground',
  granularity: 'border-border bg-muted/60 text-muted-foreground',
  requestParameter: 'border-primary/35 bg-primary/10 text-foreground',
  other: 'border-border bg-background text-foreground',
}

function ParamChip({ chip }: { chip: CallChip }) {
  return (
    <span
      className={cn(CHIP_BASE, CHIP_CLASS[chip.kind])}
      style={chipStyle(chip.kind)}
      title={chip.title}
    >
      <span className="break-all font-mono font-medium">{chip.label}</span>
      {chip.value != null && (
        <span className="break-all font-mono opacity-80">{chip.value}</span>
      )}
    </span>
  )
}

function CallEntry({ call }: { call: RecordedCall }) {
  const curl = curlFor(call, apiBase())
  const { method, route, chips } = summarizeCall(call)
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <MethodChip method={method} />
        <span className="min-w-0 break-all font-mono text-foreground">{route}</span>
        {call.repeat != null && call.repeat > 1 && (
          <span
            className={cn(CHIP_BASE, 'border-border bg-muted/60 text-muted-foreground')}
            title="Consecutive similar calls (record lookups or per-cell probes); the latest is shown"
          >
            ×{call.repeat}
          </span>
        )}
      </div>
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((chip, index) => (
            <ParamChip key={`${chip.label}-${index}`} chip={chip} />
          ))}
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
          {call.body != null ? 'Request body and curl' : 'curl'}
        </summary>
        {call.body != null && (
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-muted-foreground">
            {JSON.stringify(call.body, null, 2)}
          </pre>
        )}
        <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-foreground">
          {curl}
        </pre>
      </details>
      <button
        type="button"
        className="mt-2 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        onClick={() => navigator.clipboard.writeText(curl)}
      >
        Copy curl
      </button>
    </div>
  )
}

export function ApiDrawer() {
  const [calls, setCalls] = useState<RecordedCall[]>(() => getRecentBeaconCalls())

  useEffect(() => subscribeBeaconCalls(setCalls), [])

  const latest = calls[0]
  if (!latest) return null
  const summary = summarizeCall(latest)

  return (
    <details className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background shadow-lg">
      <summary
        className="flex cursor-pointer items-center gap-2 px-4 py-2 text-xs font-medium text-foreground"
        title={latest.path}
      >
        <span className="shrink-0">Show API call</span>
        <MethodChip method={summary.method} />
        <span className="min-w-0 truncate font-mono">{summary.route}</span>
        {summary.chips.length > 0 && (
          <span className="shrink-0 text-muted-foreground">
            {summary.chips.length} param{summary.chips.length === 1 ? '' : 's'}
          </span>
        )}
        {calls.length > 1 && (
          <span className="ml-auto shrink-0 text-muted-foreground">
            {calls.length} recent
          </span>
        )}
      </summary>
      <div className="max-h-72 overflow-auto border-t border-border px-4 py-1 text-xs">
        {calls.map((call) => (
          <CallEntry key={call.id} call={call} />
        ))}
      </div>
    </details>
  )
}
