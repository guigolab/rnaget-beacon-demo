import type { ReactNode } from 'react'

type DetailSurfaceHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  density?: 'popover' | 'drawer'
}

export function DetailSurfaceHeader({
  title,
  subtitle,
  meta,
  actions,
  density = 'popover',
}: DetailSurfaceHeaderProps) {
  const pad = density === 'drawer' ? 'px-4 py-3' : 'px-3 py-2.5'
  return (
    <div className={`border-b border-border ${pad}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={
              density === 'drawer'
                ? 'text-base font-semibold leading-snug text-foreground'
                : 'text-sm font-semibold leading-snug text-foreground'
            }
          >
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
          {meta ? (
            <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </div>
  )
}
