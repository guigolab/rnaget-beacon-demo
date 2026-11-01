import { HEATMAP_CELL_CLASS } from '@/lib/heatmap-table'

export function HeatmapMatrixCellLoading() {
  return (
    <span
      className={`${HEATMAP_CELL_CLASS} bg-muted/45`}
      role="status"
      aria-label="Loading expression value"
    >
      <span className="inline-block h-2 w-8 max-w-[70%] animate-pulse rounded-full bg-muted-foreground/35" />
    </span>
  )
}

export function HeatmapMatrixCellEmpty({
  backgroundColor,
  color,
}: {
  backgroundColor: string
  color: string
}) {
  return (
    <span
      className={`${HEATMAP_CELL_CLASS} cursor-default text-muted-foreground/70`}
      style={{ backgroundColor, color }}
      aria-hidden
    >
      —
    </span>
  )
}
