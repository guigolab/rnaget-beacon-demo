'use client'

import { useEffect, useState } from 'react'
import {
  apiBase,
  curlFor,
  getLastBeaconCall,
  subscribeBeaconCalls,
  type RecordedCall,
} from '@/lib/beacon'

export function ApiDrawer() {
  const [call, setCall] = useState<RecordedCall | null>(getLastBeaconCall())

  useEffect(() => subscribeBeaconCalls(setCall), [])

  if (!call) return null

  return (
    <details className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background shadow-lg">
      <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-foreground">
        Show API call · {call.method} {call.path}
      </summary>
      <div className="max-h-48 overflow-auto border-t border-border px-4 py-2 text-xs">
        {call.body != null && (
          <pre className="whitespace-pre-wrap break-all font-mono text-muted-foreground">
            {JSON.stringify(call.body, null, 2)}
          </pre>
        )}
        <pre className="mt-2 whitespace-pre-wrap break-all bg-muted p-2 font-mono text-foreground">
          {curlFor(call, apiBase())}
        </pre>
        <button
          type="button"
          className="mt-2 border border-border px-2 py-1 text-xs hover:bg-muted"
          onClick={() => navigator.clipboard.writeText(curlFor(call, apiBase()))}
        >
          Copy curl
        </button>
      </div>
    </details>
  )
}
