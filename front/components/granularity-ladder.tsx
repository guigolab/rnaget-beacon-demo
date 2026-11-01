'use client'

import type { Granularity } from '@/lib/beacon'

const STEPS: Granularity[] = ['boolean', 'count', 'record']

const LABELS: Record<Granularity, string> = {
  boolean: 'Exists',
  count: 'Count',
  record: 'Records',
}

export function GranularityLadder({
  value,
  exists,
  total,
  locked,
  onChange,
}: {
  value: Granularity
  exists?: boolean
  total?: number
  locked?: boolean
  onChange: (value: Granularity) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, index) => {
        const active = value === step
        const disabled = locked && step !== 'boolean'
        const detail =
          step === 'boolean'
            ? exists == null
              ? '—'
              : exists
                ? 'Yes'
                : 'No'
            : step === 'count'
              ? total == null
                ? '—'
                : total.toLocaleString()
              : value === 'record' && total != null
                ? `${total.toLocaleString()} total`
                : 'Open rows'
        return (
          <button
            key={step}
            type="button"
            disabled={disabled}
            onClick={() => onChange(step)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? 'border-[#0c7c86] bg-[#0c7c86] text-white'
                : 'border-[#cbd9de] bg-white text-[#27404a] hover:border-[#0c7c86]'
            }`}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-80">
              {index + 1}. {LABELS[step]}
            </span>
            <span className="mt-0.5 block font-medium">{detail}</span>
          </button>
        )
      })}
    </div>
  )
}
