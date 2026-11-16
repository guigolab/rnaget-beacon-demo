import { HEATMAP_FEATURE_COL_CLASS, HEATMAP_FEW_BIOSAMPLE_MAX } from '@/lib/heatmap-table'
import { HeatmapMatrixCellLoading } from '@/components/heatmap-matrix-cell'

const SKELETON_COLUMNS_MAX = 12
const SKELETON_ROWS_MAX = 5

/**
 * Placeholder grid sized from the matrix dimensions, so the table keeps its final
 * shape (and the page does not jump) while the first ranked slice loads.
 */
export function MatrixGridSkeleton({
  featureTotal,
  biosampleTotal,
}: {
  featureTotal: number
  biosampleTotal: number
}) {
  const few = biosampleTotal > 0 && biosampleTotal <= HEATMAP_FEW_BIOSAMPLE_MAX
  const cols = Math.max(1, Math.min(biosampleTotal || SKELETON_COLUMNS_MAX, few ? biosampleTotal : SKELETON_COLUMNS_MAX))
  const rows = Math.max(1, Math.min(featureTotal || SKELETON_ROWS_MAX, SKELETON_ROWS_MAX))
  return (
    <div className="overflow-hidden" role="status" aria-label="Loading expression matrix">
      <table
        className={
          few ? 'w-full table-fixed border-collapse text-xs' : 'w-full min-w-max border-collapse text-xs'
        }
      >
        <thead>
          <tr>
            <th
              className={`border-b border-r border-border bg-muted px-2 py-2 ${
                few ? HEATMAP_FEATURE_COL_CLASS : 'min-w-[9rem]'
              }`}
            >
              <span className="block h-2.5 w-14 animate-pulse rounded bg-muted-foreground/25" />
            </th>
            {Array.from({ length: cols }, (_, c) => (
              <th key={c} className="border-b border-border bg-muted px-0.5 py-2.5">
                <span className="mx-auto block h-2.5 w-10 animate-pulse rounded bg-muted-foreground/25" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <th
                scope="row"
                className={`border-r border-border bg-card px-2 py-2.5 ${
                  few ? HEATMAP_FEATURE_COL_CLASS : ''
                }`}
              >
                <span className="block h-3 w-20 animate-pulse rounded bg-muted-foreground/25" />
              </th>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} className="border-b border-border/60 p-0.5">
                  <HeatmapMatrixCellLoading ariaLabel="Loading" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
