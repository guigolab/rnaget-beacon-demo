import { BAND_LEGEND, bandLabel } from '@/lib/expression-band'

export function BandHeatmapLegend({ className = '' }: { className?: string }) {
  return (
    <ul
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}
      aria-label="Expression band legend"
    >
      {BAND_LEGEND.map(({ band, fill }) => (
        <li key={band} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 shrink-0 rounded-sm border border-border/60"
            style={{ backgroundColor: fill }}
            aria-hidden
          />
          <span>{bandLabel(band)}</span>
        </li>
      ))}
    </ul>
  )
}
