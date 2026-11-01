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
