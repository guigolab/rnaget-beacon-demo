/** Server caps (`server/routers/deps.py`). */
export const EXPRESSION_VALUE_PAGE_MAX = 1000
export const ID_LIST_TOKEN_MAX = 200
export const ID_LIST_CHAR_MAX = 7_500

export type CellWindowRequest = {
  featureIds: string[]
  biosampleIds: string[]
}

export function chunkIdList(ids: string[], maxEntries: number, maxChars: number): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let chars = 0
  const entryCap = Math.max(1, maxEntries)
  const charCap = Math.max(1, maxChars)
  for (const raw of ids) {
    const id = raw.trim()
    if (!id) continue
    const separator = current.length ? 1 : 0
    if (
      current.length >= entryCap ||
      (current.length > 0 && chars + separator + id.length > charCap)
    ) {
      chunks.push(current)
      current = [id]
      chars = id.length
      continue
    }
    current.push(id)
    chars += separator + id.length
  }
  if (current.length) chunks.push(current)
  return chunks
}

/** Split a visible window into expression_values requests that fit server limits. */
export function planCellWindowRequests(
  featureIds: string[],
  biosampleIds: string[]
): CellWindowRequest[] {
  const features = featureIds.map((id) => id.trim()).filter(Boolean)
  const biosamples = biosampleIds.map((id) => id.trim()).filter(Boolean)
  if (!features.length || !biosamples.length) return []

  const featureChunks = chunkIdList(features, ID_LIST_TOKEN_MAX, ID_LIST_CHAR_MAX)
  const requests: CellWindowRequest[] = []
  for (const featureChunk of featureChunks) {
    const perRequest = Math.max(
      1,
      Math.min(ID_LIST_TOKEN_MAX, Math.floor(EXPRESSION_VALUE_PAGE_MAX / featureChunk.length))
    )
    const biosampleChunks = chunkIdList(biosamples, perRequest, ID_LIST_CHAR_MAX)
    for (const biosampleChunk of biosampleChunks) {
      requests.push({ featureIds: featureChunk, biosampleIds: biosampleChunk })
    }
  }
  return requests
}
