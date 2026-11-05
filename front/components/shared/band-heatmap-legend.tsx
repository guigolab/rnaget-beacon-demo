import {
  FEATURE_PERCENTILE_LEGEND,
  bandLabel,
  type BandCellValue,
} from '@/lib/expression-band'
import {
  TISSUE_BAND_LEGEND,
  tissueBandLabel,
  type TissueBand,
} from '@/lib/tissue-levels'

type BandHeatmapLegendProps = {
  className?: string
  /** Feature median-percentile thresholds (default) or Explore tissue bands. */
  variant?: 'percentile' | 'tissue'
  /** Optional view filter for Explore tissue bands (dims non-matching when set). */
  viewBand?: TissueBand | null
  onViewBandChange?: (band: TissueBand | null) => void
}

export function BandHeatmapLegend({
  className = '',
  variant = 'percentile',
  viewBand = null,
  onViewBandChange,
}: BandHeatmapLegendProps) {
  if (variant === 'tissue') {
    return (
      <ul
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}
        aria-label="Tissue expression band legend"
      >
        <li className="text-[10px] uppercase tracking-wide">View</li>
        {TISSUE_BAND_LEGEND.map(({ band, fill }) => {
          const active = viewBand === band
          const muted = viewBand != null && !active
          return (
            <li key={String(band)}>
              <button
                type="button"
                title={
                  onViewBandChange
                    ? active
                      ? 'Clear view filter'
                      : `Show only ${tissueBandLabel(band)}`
                    : tissueBandLabel(band)
                }
                className={`inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-opacity ${
                  muted ? 'opacity-40' : ''
                } ${onViewBandChange ? 'hover:bg-muted/60' : ''}`}
                onClick={() => {
                  if (!onViewBandChange) return
                  onViewBandChange(active ? null : band)
                }}
                disabled={!onViewBandChange}
              >
                <span className="relative inline-block size-2.5 shrink-0">
                  <span
                    className="absolute inset-0 rounded-sm border border-border/60"
                    style={{
                      backgroundColor: fill,
                      backgroundImage:
                        band === 'none'
                          ? 'repeating-linear-gradient(45deg, transparent, transparent 1px, rgba(0,0,0,0.12) 1px, rgba(0,0,0,0.12) 2px)'
                          : undefined,
                    }}
                    aria-hidden
                  />
                </span>
                <span>{tissueBandLabel(band)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const entries: Array<{ band: BandCellValue; fill: string }> =
    FEATURE_PERCENTILE_LEGEND
  return (
    <ul
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}
      aria-label="Expression percentile legend"
    >
      {entries.map(({ band, fill }) => (
        <li key={String(band)} className="flex items-center gap-1.5">
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
