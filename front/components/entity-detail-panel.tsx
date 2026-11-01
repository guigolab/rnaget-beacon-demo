'use client'

import { FeatureDetailBody } from '@/components/features/feature-detail-body'
import { BiosampleDetailBody } from '@/components/biosamples/biosample-detail-body'
import type { Biosample, Feature } from '@/lib/beacon'

export function EntityDetailPanel({
  kind,
  item,
}: {
  kind: 'feature' | 'biosample'
  item: Feature | Biosample
}) {
  if (kind === 'feature') {
    return <FeatureDetailBody feature={item as Feature} density="drawer" />
  }
  return <BiosampleDetailBody sample={item as Biosample} density="drawer" />
}
