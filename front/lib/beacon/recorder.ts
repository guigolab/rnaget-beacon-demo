export type RecordedCall = {
  id: string
  method: string
  path: string
  body?: unknown
  response?: unknown
  at: string
}

export const RECENT_CALL_LIMIT = 5

let recentCalls: RecordedCall[] = []
let nextCallId = 0
const listeners = new Set<(calls: RecordedCall[]) => void>()

const MAX_RECORDED_RESPONSE_CHARS = 12_000

function trimResponse(response: unknown): unknown {
  if (response == null) return response
  try {
    const text = JSON.stringify(response)
    if (text.length <= MAX_RECORDED_RESPONSE_CHARS) return response
    return {
      _truncated: true,
      preview: text.slice(0, MAX_RECORDED_RESPONSE_CHARS),
    }
  } catch {
    return { _truncated: true }
  }
}

function notify() {
  const snapshot = recentCalls.slice()
  listeners.forEach((fn) => fn(snapshot))
}

export function recordBeaconCall(call: Omit<RecordedCall, 'id' | 'at'>) {
  nextCallId += 1
  const next: RecordedCall = {
    ...call,
    id: `call-${nextCallId}`,
    response: trimResponse(call.response),
    at: new Date().toISOString(),
  }
  recentCalls = [next, ...recentCalls].slice(0, RECENT_CALL_LIMIT)
  notify()
}

export function getLastBeaconCall(): RecordedCall | null {
  return recentCalls[0] ?? null
}

export function getRecentBeaconCalls(): RecordedCall[] {
  return recentCalls.slice()
}

export function subscribeBeaconCalls(fn: (calls: RecordedCall[]) => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function curlFor(
  call: Pick<RecordedCall, 'method' | 'path' | 'body'>,
  baseUrl: string
): string {
  const url = `${baseUrl.replace(/\/$/, '')}${call.path}`
  if (call.method === 'GET') return `curl -sS '${url}' -H 'Accept: application/json'`
  return `curl -sS -X POST '${url}' -H 'Content-Type: application/json' -d '${JSON.stringify(call.body ?? {})}'`
}
