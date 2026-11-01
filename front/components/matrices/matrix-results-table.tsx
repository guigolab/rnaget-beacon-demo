'use client'

import Link from 'next/link'
import type { Matrix } from '@/lib/beacon/types'
import { matrixHref } from '@/lib/beacon'
import { matrixDisplayLabel } from '@/lib/matrix-lens'

type MatrixResultsTableProps = {
  matrices: Matrix[]
  selectedMatrixId: string | null
  buildMatrixRowHref: (matrixId: string) => string
}

export function MatrixResultsTable({
  matrices,
  selectedMatrixId,
  buildMatrixRowHref,
}: MatrixResultsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Matrix</th>
            <th className="px-3 py-2">Assay</th>
            <th className="px-3 py-2">Annotation</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2">Dimensions</th>
            <th className="px-3 py-2">Open</th>
          </tr>
        </thead>
        <tbody>
          {matrices.map((matrix) => {
            const id = matrix.matrixId ?? ''
            const selected = id === selectedMatrixId
            return (
              <tr
                key={id}
                className={`border-b border-border/60 ${
                  selected ? 'bg-[var(--scope-matrix-bg)]' : 'hover:bg-muted/30'
                }`}
              >
                <td className="px-3 py-2 font-medium">
                  <Link
                    href={buildMatrixRowHref(id)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {matrixDisplayLabel(matrix)}
                  </Link>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {id}
                  </p>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {matrix.assayType?.label ?? '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {[matrix.annotation?.source, matrix.annotation?.version]
                    .filter(Boolean)
                    .join(' ') || '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {matrix.expressionUnitAndScale?.unit ?? '—'}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {matrix.dimensions?.features?.toLocaleString() ?? '—'} ×{' '}
                  {matrix.dimensions?.biosamples?.toLocaleString() ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={matrixHref(id)}
                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Workspace
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
