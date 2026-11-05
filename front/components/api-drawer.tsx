'use client'

import { useEffect, useState } from 'react'
import {
  apiBase,
  curlFor,
  getRecentBeaconCalls,
  subscribeBeaconCalls,
  type RecordedCall,
} from '@/lib/beacon'

const PATH_DISPLAY_MAX = 72

function ellipsizePath(path: string, max = PATH_DISPLAY_MAX): string {
  if (path.length <= max) return path
  if (max <= 3) return '...'
  return `${path.slice(0, max - 3)}...`
}

function CallEntry({ call }: { call: RecordedCall }) {
  const curl = curlFor(call, apiBase())
  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <p className="font-medium text-foreground" title={`${call.method} ${call.path}`}>
        {call.method} {ellipsizePath(call.path)}
      </p>
      {call.body != null && (
        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-muted-foreground">
          {JSON.stringify(call.body, null, 2)}
        </pre>
      )}
      <pre className="mt-2 whitespace-pre-wrap break-all bg-muted p-2 font-mono text-foreground">
        {curl}
      </pre>
      <button
        type="button"
        className="mt-2 border border-border px-2 py-1 text-xs hover:bg-muted"
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

  return (
    <details className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background shadow-lg">
      <summary
        className="cursor-pointer px-4 py-2 text-xs font-medium text-foreground"
        title={`${latest.method} ${latest.path}`}
      >
        Show API call · {latest.method} {ellipsizePath(latest.path)}
        {calls.length > 1 ? ` · ${calls.length} recent` : ''}
      </summary>
      <div className="max-h-64 overflow-auto border-t border-border px-4 py-1 text-xs">
        {calls.map((call) => (
          <CallEntry key={call.id} call={call} />
        ))}
      </div>
    </details>
  )
}
