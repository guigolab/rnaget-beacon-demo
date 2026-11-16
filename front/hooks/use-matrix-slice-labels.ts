'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  isAbortError,
  lookupMatrixBiosamples,
  lookupMatrixFeatures,
  type Biosample,
  type Feature,
} from '@/lib/beacon'
import {
  mergeFeatureRecordsByNativeId,
  mergeRecordsById,
  stubBiosamplesFromIds,
  stubFeaturesFromIds,
} from '@/lib/matrix-expression-slice'

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

  const [featureRecords, setFeatureRecords] = useState<Feature[]>([])
  const [biosampleRecords, setBiosampleRecords] = useState<Biosample[]>([])
  const [featureRecordsKey, setFeatureRecordsKey] = useState('')
  const [biosampleRecordsKey, setBiosampleRecordsKey] = useState('')

  useEffect(() => {
    if (!enabled || !input.featureIds.length) {
      setFeatureRecords([])
      setFeatureRecordsKey(featureKey)
      return
    }
    const controller = new AbortController()
    lookupMatrixFeatures(input.matrixId, input.featureIds, {
      signal: controller.signal,
    })
      .then((records) => {
        if (controller.signal.aborted) return
        setFeatureRecords(records)
        setFeatureRecordsKey(featureKey)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setFeatureRecords([])
        setFeatureRecordsKey(featureKey)
      })
    return () => controller.abort()
  }, [enabled, featureKey, input.featureIds, input.matrixId])

  useEffect(() => {
    if (!enabled || !input.biosampleIds.length) {
      setBiosampleRecords([])
      setBiosampleRecordsKey(biosampleKey)
      return
    }
    const controller = new AbortController()
    lookupMatrixBiosamples(input.matrixId, input.biosampleIds, {
      signal: controller.signal,
    })
      .then((records) => {
        if (controller.signal.aborted) return
        setBiosampleRecords(records)
        setBiosampleRecordsKey(biosampleKey)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setBiosampleRecords([])
        setBiosampleRecordsKey(biosampleKey)
      })
    return () => controller.abort()
  }, [biosampleKey, enabled, input.biosampleIds, input.matrixId])

  const features = useMemo(() => {
    if (featureRecordsKey !== featureKey) return stubsFeatures
    return mergeFeatureRecordsByNativeId(stubsFeatures, featureRecords)
  }, [featureKey, featureRecords, featureRecordsKey, stubsFeatures])

  const biosamples = useMemo(() => {
    if (biosampleRecordsKey !== biosampleKey) return stubsBiosamples
    return mergeRecordsById(stubsBiosamples, biosampleRecords)
  }, [biosampleKey, biosampleRecords, biosampleRecordsKey, stubsBiosamples])

  return { features, biosamples }
}
