import type { BeaconMeta } from '@/lib/beacon'

export function BeaconReceipt({ meta }: { meta?: BeaconMeta }) {
  if (!meta?.beaconId && !meta?.returnedGranularity) return null
  const filters = meta.receivedRequestSummary?.filters
  const applied = Array.isArray(filters)
    ? filters
        .map((filter) => {
          if (!filter || typeof filter !== 'object') return ''
          if (filter.operator && filter.value != null) {
            return `${filter.id ?? ''} ${filter.operator} ${filter.value}`
          }
          return filter.id ?? ''
        })
        .filter(Boolean)
        .join(', ')
    : ''
  return (
    <p className="font-mono text-[11px] leading-5 text-[#829198]">
      {meta.beaconId}
      {meta.returnedGranularity ? ` · ${meta.returnedGranularity}` : ''}
      {applied ? ` · ${applied}` : ''}
    </p>
  )
}
