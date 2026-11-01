'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  MatrixDetailHeaderBadges,
  matrixDetailDescription,
  matrixPageHeaderDownloads,
} from '@/components/matrices/matrix-detail-body'
import { MatrixWorkspace } from '@/components/matrices/workspace/matrix-workspace'
import { LensPageShell } from '@/components/shared/lens-page-shell'
import { Button } from '@/components/ui/button'
import { EmptyState, PageFrame, PageHeader } from '@/components/ui-kit'
import { getMatrix, isAbortError, type Matrix } from '@/lib/beacon'
import { matrixDisplayLabel } from '@/lib/matrix-lens'

function decodeMatrixRouteId(routeId: string): string {
  try {
    return decodeURIComponent(routeId)
  } catch {
    return routeId
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; matrix: Matrix }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export function MatrixDetailClient({ routeId }: { routeId: string }) {
  const matrixId = decodeMatrixRouteId(routeId)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setState({ status: 'loading' })
    getMatrix(matrixId, controller.signal)
      .then((item) => {
        if (cancelled) return
        setState(item ? { status: 'ready', matrix: item } : { status: 'missing' })
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load matrix',
        })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [attempt, matrixId])

  return (
    <LensPageShell>
      <PageFrame>
        <Link
          href="/matrices/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All matrices
        </Link>

        {state.status === 'loading' && <MatrixDetailSkeleton />}

        {state.status === 'missing' && (
          <EmptyState
            title="Matrix not found"
            description={`No matrix is registered with id ${matrixId}.`}
          />
        )}

        {state.status === 'error' && (
          <div className="space-y-3">
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {state.message}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <PageHeader
              title={matrixDisplayLabel(state.matrix)}
              id={matrixId}
              description={matrixDetailDescription(state.matrix)}
              badges={<MatrixDetailHeaderBadges matrix={state.matrix} />}
              downloads={matrixPageHeaderDownloads(state.matrix)}
            />
            <Suspense fallback={<p className="mt-6 text-sm text-muted-foreground">Loading matrix workspace…</p>}>
              <MatrixWorkspace key={state.matrix.matrixId} matrix={state.matrix} />
            </Suspense>
          </>
        )}
      </PageFrame>
    </LensPageShell>
  )
}

function MatrixDetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  )
}
