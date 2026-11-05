/** Shared heatmap matrix table styling (Features lens + matrix detail). */
export const HEATMAP_CELL_CLASS =
  'flex h-10 w-full min-w-[3rem] items-center justify-center rounded-md text-xs tabular-nums'

/** Sticky feature label column — fixed width so extra table width goes to value columns. */
export const HEATMAP_FEATURE_COL_CLASS = 'w-[9rem] min-w-[9rem] max-w-[9rem]'

/** Below this count, matrix heatmap uses full-width equal data columns (no horizontal virtual cols). */
export const HEATMAP_FEW_BIOSAMPLE_MAX = 32

/** Fallback / target width for virtualized data columns (matrix + explore). */
export const HEATMAP_COL_FALLBACK_PX = 72

/** Extra columns rendered beyond the viewport for horizontal virtualization. */
export const HEATMAP_COL_OVERSCAN = 4

export type HeatmapColumnWindow = {
  start: number
  end: number
  padLeft: number
  padRight: number
}

/**
 * Horizontal column window for fixed-width virtualized heatmaps.
 * When `few` is true, the full range is returned (no padding).
 */
export function heatmapColumnWindow(opts: {
  columnCount: number
  scrollLeft: number
  viewportW: number
  colWidth: number
  few: boolean
  overscan?: number
}): HeatmapColumnWindow {
  const {
    columnCount,
    scrollLeft,
    viewportW,
    colWidth,
    few,
    overscan = HEATMAP_COL_OVERSCAN,
  } = opts
  if (few || columnCount <= 0 || colWidth <= 0) {
    return { start: 0, end: columnCount, padLeft: 0, padRight: 0 }
  }
  const viewport = viewportW || 800
  const start = Math.max(0, Math.floor(scrollLeft / colWidth) - overscan)
  const end = Math.min(
    columnCount,
    Math.ceil((scrollLeft + viewport) / colWidth) + overscan
  )
  return {
    start,
    end,
    padLeft: start * colWidth,
    padRight: Math.max(0, columnCount - end) * colWidth,
  }
}
