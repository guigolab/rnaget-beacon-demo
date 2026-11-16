'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  isAbortError,
  lookupMatrixBiosamples,
  lookupMatrixFeatures,
  type Biosample,
  type Feature,
} from '@/lib/beacon'
import { nativeFeatureId } from '@/lib/heatmap-expression'
import {
  mergeFeatureRecordsByNativeId,
  mergeRecordsById,
  stubBiosamplesFromIds,
  stubFeaturesFromIds,
} from '@/lib/matrix-expression-slice'

const CACHE_CAP = 4000

/**
 * Enrich slice-derived feature/biosample ids with nested matrix axis records.
 * Stubs render immediately; enrichment is best-effort and non-blocking.
 */
export function useMatrixSliceLabels(input: {
  matrixId: string
  featureIds: readonly string[]
  biosampleIds: readonly string[]
  enabled?: boolean
}): {
  features: Feature[]
  biosamples: Biosample[]
} {
  const enabled = input.enabled !== false
  const featureKey = input.featureIds.join('|')
  const biosampleKey = input.biosampleIds.join('|')
  const stubsFeatures = useMemo(
    () => stubFeaturesFromIds(input.featureIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [featureKey]
  )
  const stubsBiosamples = useMemo(
    () => stubBiosamplesFromIds(input.biosampleIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [biosampleKey]
  )

  // Enriched records survive window changes, so symbols do not flash back to ids and
  // only ids not seen yet are looked up.
  const featureCache = useRef(new Map<string, Feature>())
  const biosampleCache = useRef(new Map<string, Biosample>())
  const [featureVersion, setFeatureVersion] = useState(0)
  const [biosampleVersion, setBiosampleVersion] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const missing = input.featureIds.filter((id) => !featureCache.current.has(id))
    if (!missing.length) return
    const controller = new AbortController()
    lookupMatrixFeatures(input.matrixId, missing, { signal: controller.signal })
      .then((records) => {
        if (controller.signal.aborted) return
        if (featureCache.current.size > CACHE_CAP) featureCache.current.clear()
        for (const record of records) {
          featureCache.current.set(nativeFeatureId(record).trim(), record)
        }
        setFeatureVersion((n) => n + 1)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
      })
    return () => controller.abort()
  }, [enabled, featureKey, input.featureIds, input.matrixId])

  useEffect(() => {
    if (!enabled) return
    const missing = input.biosampleIds.filter((id) => !biosampleCache.current.has(id))
    if (!missing.length) return
    const controller = new AbortController()
    lookupMatrixBiosamples(input.matrixId, missing, { signal: controller.signal })
      .then((records) => {
        if (controller.signal.aborted) return
        if (biosampleCache.current.size > CACHE_CAP) biosampleCache.current.clear()
        for (const record of records) biosampleCache.current.set(record.id, record)
        setBiosampleVersion((n) => n + 1)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
      })
    return () => controller.abort()
  }, [biosampleKey, enabled, input.biosampleIds, input.matrixId])

  const features = useMemo(
    () => mergeFeatureRecordsByNativeId(stubsFeatures, [...featureCache.current.values()]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stubsFeatures, featureVersion]
  )

  const biosamples = useMemo(
    () => mergeRecordsById(stubsBiosamples, [...biosampleCache.current.values()]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stubsBiosamples, biosampleVersion]
  )

  return { features, biosamples }
}
