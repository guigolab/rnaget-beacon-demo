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
  const [open, setOpen] = useState(false)
  const [call, setCall] = useState<RecordedCall | null>(getLastBeaconCall())

  useEffect(() => subscribeBeaconCalls(setCall), [])

  if (!call) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-md flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="self-end rounded-full bg-[#0c7c86] px-4 py-2 text-xs font-medium text-white shadow-lg"
      >
        {open ? 'Hide API call' : 'Show API call'}
      </button>
      {open && (
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-[#dfe7eb] bg-white p-3 text-xs shadow-xl">
          <p className="font-mono text-[#52666f]">
            {call.method} {call.path}
          </p>
          {call.body != null && (
            <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-[#f4f8f9] p-2 font-mono text-[10px]">
              {JSON.stringify(call.body, null, 2)}
            </pre>
          )}
          <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-[#15232c] p-2 font-mono text-[10px] text-[#e8f4f3]">
            {curlFor(call, apiBase())}
          </pre>
        </div>
      )}
    </div>
  )
}
