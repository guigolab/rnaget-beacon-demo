/** Shared heatmap matrix table styling (Features lens + matrix detail). */
export const HEATMAP_CELL_CLASS =
  'flex h-10 w-full min-w-[3rem] items-center justify-center rounded-md text-xs tabular-nums'

/** Sticky feature label column — fixed width so extra table width goes to value columns. */
export const HEATMAP_FEATURE_COL_CLASS = 'w-[9rem] min-w-[9rem] max-w-[9rem]'

/** Below this count, matrix heatmap uses full-width equal data columns (no horizontal virtual cols). */
export const HEATMAP_FEW_BIOSAMPLE_MAX = 32

export function heatmapCellKeysForSlice(
  featureIds: string[],
  biosampleIds: string[],
  cellKey: (featureId: string, biosampleId: string) => string
): string[] {
  const keys: string[] = []
  for (const featureId of featureIds) {
    for (const biosampleId of biosampleIds) {
      keys.push(cellKey(featureId, biosampleId))
    }
  }
  return keys
}
