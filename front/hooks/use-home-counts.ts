'use client'

import { useEffect, useState } from 'react'
import {
  isAbortError,
  listBiosamples,
  listFeatures,
  listMatrices,
} from '@/lib/beacon'

export type HomeCounts = {
  features: number | null
  biosamples: number | null
  matrices: number | null
  loading: boolean
  error: string
}

const idle: HomeCounts = {
  features: null,
  biosamples: null,
  matrices: null,
  loading: true,
  error: '',
}

export function useHomeCounts(): HomeCounts {
  const [state, setState] = useState<HomeCounts>(idle)

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: '' }))

    Promise.all([
      listFeatures(0, 0, {
        granularity: 'count',
        signal: controller.signal,
      }).then((p) => p.total ?? null),
      listBiosamples(0, 0, {
        granularity: 'count',
        signal: controller.signal,
      }).then((p) => p.total ?? null),
      listMatrices(0, 0, {
        granularity: 'count',
        signal: controller.signal,
      }).then((p) => p.total ?? null),
    ])
      .then(([features, biosamples, matrices]) => {
        if (controller.signal.aborted) return
        setState({
          features,
          biosamples,
          matrices,
          loading: false,
          error: '',
        })
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return
        setState({
          features: null,
          biosamples: null,
          matrices: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Cannot load counts.',
        })
      })

    return () => controller.abort()
  }, [])

  return state
}
