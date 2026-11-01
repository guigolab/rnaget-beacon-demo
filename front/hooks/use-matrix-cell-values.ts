'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isAbortError,
  listExpressionValues,
  type Biosample,
  type ExpressionValue,
  type Feature,
} from '@/lib/beacon'
import { mapPool } from '@/lib/async-pool'
import { planCellWindowRequests, type CellWindowRequest } from '@/lib/matrix-cell-window'
import { cellKey, indexExpression, nativeFeatureId } from '@/lib/heatmap-expression'

/** Bound the session cache so loading a whole matrix cannot grow without limit. */
const CELL_CACHE_CAP = 8_000

type CellCache = {
  dataKey: string
  values: Map<string, number>
  loaded: Set<string>
}

function pairKey(feature: Feature, biosampleId: string) {
  return cellKey(nativeFeatureId(feature), biosampleId)
}

function cappedCache(
  dataKey: string,
  values: Map<string, number>,
  loaded: Set<string>,
  keep: Set<string>
): CellCache {
  if (loaded.size <= CELL_CACHE_CAP) return { dataKey, values, loaded }
  const nextLoaded = new Set<string>(keep)
  const nextValues = new Map<string, number>()
  for (const key of keep) {
    const value = values.get(key)
    if (value != null) nextValues.set(key, value)
  }
  for (const key of loaded) {
    if (nextLoaded.size >= CELL_CACHE_CAP) break
    if (nextLoaded.has(key)) continue
    nextLoaded.add(key)
    const value = values.get(key)
    if (value != null) nextValues.set(key, value)
  }
  return { dataKey, values: nextValues, loaded: nextLoaded }
}

async function fetchWindowRequest(
  matrixId: string,
  request: CellWindowRequest,
  minValue: number | undefined,
  maxValue: number | undefined,
  signal: AbortSignal
): Promise<ExpressionValue[]> {
  const rows: ExpressionValue[] = []
  const expected = Math.max(request.featureIds.length * request.biosampleIds.length, 1)
  let skip = 0
  while (rows.length < expected) {
    if (signal.aborted) break
    const limit = Math.min(1000, expected - rows.length)
    const page = await listExpressionValues(matrixId, {
      skip,
      limit,
      featureIDList: request.featureIds.join(','),
      biosampleIDList: request.biosampleIds.join(','),
      minValue,
      maxValue,
      signal,
    })
    if (!page.results.length) break
    rows.push(...page.results)
    skip += page.results.length
    if (page.total != null && skip >= page.total) break
    if (page.results.length < limit) break
  }
  return rows
}

export function useMatrixCellValues(input: {
  matrixId: string
  features: Feature[]
  biosamples: Biosample[]
  minValue?: number
  maxValue?: number
  enabled?: boolean
}) {
  const enabled = input.enabled !== false && input.features.length > 0 && input.biosamples.length > 0
  const dataKey = `${input.matrixId}\u0000${input.minValue ?? ''}\u0000${input.maxValue ?? ''}`
  const windowKey = `${input.features.map((feature) => feature.id).join('|')}::${input.biosamples
    .map((sample) => sample.id)
    .join('|')}`

  const cacheRef = useRef<CellCache>({
    dataKey: '',
    values: new Map(),
    loaded: new Set(),
  })
  if (cacheRef.current.dataKey !== dataKey) {
    cacheRef.current = { dataKey, values: new Map(), loaded: new Set() }
  }

  const [tick, setTick] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(dataKey)
  if (errorKey !== dataKey) {
    setErrorKey(dataKey)
    setError('')
  }
  const featuresRef = useRef(input.features)
  const biosamplesRef = useRef(input.biosamples)
  featuresRef.current = input.features
  biosamplesRef.current = input.biosamples

  const pendingKeys = useMemo(() => {
    const pending = new Set<string>()
    if (!enabled || error) return pending
    const { loaded } = cacheRef.current
    for (const feature of input.features) {
      for (const sample of input.biosamples) {
        const key = pairKey(feature, sample.id)
        if (!loaded.has(key)) pending.add(key)
      }
    }
    return pending
    // tick republishes cache updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, error, windowKey, dataKey, tick])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const features = featuresRef.current
    const biosamples = biosamplesRef.current
    const loaded = cacheRef.current.loaded
    const featureMiss = features.filter((feature) =>
      biosamples.some((sample) => !loaded.has(pairKey(feature, sample.id)))
    )
    const biosampleMiss = biosamples.filter((sample) =>
      features.some((feature) => !loaded.has(pairKey(feature, sample.id)))
    )
    if (!featureMiss.length || !biosampleMiss.length) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    const requests = planCellWindowRequests(
      featureMiss.map(nativeFeatureId),
      biosampleMiss.map((sample) => sample.id)
    )
    const requestedKeys = new Set(
      featureMiss.flatMap((feature) => biosampleMiss.map((sample) => pairKey(feature, sample.id)))
    )
    setLoading(true)
    setError('')

    async function run() {
      const groups = await mapPool(requests, 3, (request) =>
        fetchWindowRequest(
          input.matrixId,
          request,
          input.minValue,
          input.maxValue,
          controller.signal
        )
      )
      if (cancelled || cacheRef.current.dataKey !== dataKey) return
      const indexed = indexExpression(featureMiss, groups.flat())
      const values = new Map(cacheRef.current.values)
      for (const [key, value] of indexed.values) values.set(key, value)
      const loaded = new Set(cacheRef.current.loaded)
      for (const key of requestedKeys) loaded.add(key)
      cacheRef.current = cappedCache(dataKey, values, loaded, requestedKeys)
      setTick((n) => n + 1)
    }

    run()
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Expression fetch failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [attempt, dataKey, enabled, input.matrixId, input.maxValue, input.minValue, windowKey])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    values: cacheRef.current.values,
    pendingKeys,
    loading,
    error,
    retry,
  }
}
