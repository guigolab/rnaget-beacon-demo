/** Run async work over items with a fixed concurrency limit. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (!items.length) return []
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index] as T)
    }
  }
  const workers = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

/**
 * Shared Explore request limiter. Caps concurrent Beacon probes below the
 * server's API_MAX_INFLIGHT (8) so band + column probes do not stampede.
 */
export const EXPLORE_PROBE_CONCURRENCY = 6

type QueueJob = {
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  signal?: AbortSignal
}

const exploreQueue: QueueJob[] = []
let exploreActive = 0

function pumpExploreQueue() {
  while (exploreActive < EXPLORE_PROBE_CONCURRENCY && exploreQueue.length) {
    const job = exploreQueue.shift()
    if (!job) return
    if (job.signal?.aborted) {
      job.reject(new DOMException('The operation was aborted.', 'AbortError'))
      continue
    }
    exploreActive += 1
    Promise.resolve()
      .then(() => job.run())
      .then(job.resolve, job.reject)
      .finally(() => {
        exploreActive -= 1
        pumpExploreQueue()
      })
  }
}

/** Schedule work on the shared Explore probe limiter. */
export function withExploreProbeLimit<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const idx = exploreQueue.findIndex((j) => j.reject === reject)
      if (idx >= 0) exploreQueue.splice(idx, 1)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    exploreQueue.push({
      run: fn as () => Promise<unknown>,
      resolve: (value) => {
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve(value as T)
      },
      reject: (reason) => {
        if (signal) signal.removeEventListener('abort', onAbort)
        reject(reason)
      },
      signal,
    })
    pumpExploreQueue()
  })
}

/** Run items through the shared Explore limiter (order-preserving). */
export async function exploreMapPool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  if (!items.length) return []
  return Promise.all(
    items.map((item) => withExploreProbeLimit(() => fn(item), signal))
  )
}

/** Test seam. */
export function resetExploreProbeLimiter() {
  exploreQueue.length = 0
  exploreActive = 0
}
