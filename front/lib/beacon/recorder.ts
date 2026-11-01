export type RecordedCall = {
  method: string
  path: string
  body?: unknown
  response?: unknown
  at: string
}

let lastCall: RecordedCall | null = null
const listeners = new Set<(call: RecordedCall) => void>()

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

export function recordBeaconCall(call: Omit<RecordedCall, 'at'>) {
  lastCall = {
    ...call,
    response: trimResponse(call.response),
    at: new Date().toISOString(),
  }
  listeners.forEach((fn) => fn(lastCall!))
}

export function getLastBeaconCall(): RecordedCall | null {
  return lastCall
}

export function subscribeBeaconCalls(fn: (call: RecordedCall) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function curlFor(call: RecordedCall, baseUrl: string): string {
  const url = `${baseUrl.replace(/\/$/, '')}${call.path}`
  if (call.method === 'GET') return `curl -sS '${url}' -H 'Accept: application/json'`
  return `curl -sS -X POST '${url}' -H 'Content-Type: application/json' -d '${JSON.stringify(call.body ?? {})}'`
}
