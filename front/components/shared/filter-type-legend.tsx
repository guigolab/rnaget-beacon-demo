import {
  FILTER_TYPE_LEGEND,
  filterTypeDotStyle,
} from '@/lib/filter-type-theme'

/** Compact three-dot legend for ontology / alphanumeric / custom chip colors. */
export function FilterTypeLegend({ className = '' }: { className?: string }) {
  return (
    <ul
      className={`flex items-center gap-3 ${className}`}
      aria-label="Filter term types"
    >
      {FILTER_TYPE_LEGEND.map(({ type, label }) => (
        <li
          key={type}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          title={label}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={filterTypeDotStyle(type)}
            aria-hidden
          />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  )
}
