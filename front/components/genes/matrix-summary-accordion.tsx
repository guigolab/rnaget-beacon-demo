'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { ExpressionSummary } from '@/lib/beacon/client'
import type { Feature, Matrix } from '@/lib/beacon/types'
import { matrixSignature } from '@/lib/comparability'
import { primarySummaryForMatrix } from '@/lib/gene-lens'
import { GeneMatrixPreviewRow } from '@/components/genes/gene-matrix-preview-row'

type MatrixSummaryAccordionProps = {
  matrices: Matrix[]
  summariesByMatrix: Record<string, ExpressionSummary[]>
  feature: Feature
  symbol: string
}

export function MatrixSummaryAccordion({
  matrices,
  summariesByMatrix,
  feature,
  symbol,
}: MatrixSummaryAccordionProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (!matrices.length) {
    return (
      <p className="text-sm text-muted-foreground">No matrices in this unit group.</p>
    )
  }

  return (
    <div className="space-y-2">
      {matrices.map((matrix) => {
        const mid = matrix.matrixId!
        const rows = summariesByMatrix[mid] ?? []
        const primary = primarySummaryForMatrix(rows)
        const sig = matrixSignature(matrix)
        const expanded = openId === mid

        return (
          <article key={mid} className="rounded-lg border border-border bg-card shadow-sm">
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30"
              aria-expanded={expanded}
              onClick={() => setOpenId(expanded ? null : mid)}
            >
              <ChevronDown
                className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{matrix.name ?? mid}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{mid}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sig.source} {sig.version} · {sig.assembly}
                </p>
              </div>
              <div className="shrink-0 text-right text-sm tabular-nums">
                <p>n={primary?.n ?? '—'}</p>
                <p className="text-muted-foreground">
                  median {primary?.median?.toFixed(2) ?? '—'}
                </p>
              </div>
            </button>
            {expanded && (
              <div className="border-t border-border px-4 pb-4">
                <GeneMatrixPreviewRow
                  matrixId={mid}
                  feature={feature}
                  symbol={symbol}
                  summary={primary}
                />
                <Link
                  href={`/matrices/${encodeURIComponent(mid)}`}
                  className="mt-2 inline-block text-xs text-primary underline"
                >
                  Matrix workspace
                </Link>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
