export function appendAxisPage<T extends { id: string }>(current: T[], page: T[]): T[] {
  if (!page.length) return current
  const seen = new Set(current.map((item) => item.id))
  let next: T[] | null = null
  for (const item of page) {
    if (!item.id || seen.has(item.id)) continue
    seen.add(item.id)
    if (!next) next = current.slice()
    next.push(item)
  }
  return next ?? current
}
