import type { ReactNode } from 'react'

export function DetailScrollBody({
  children,
  density = 'popover',
  className = '',
}: {
  children: ReactNode
  density?: 'popover' | 'drawer'
  className?: string
}) {
  if (density === 'drawer') {
    return (
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm ${className}`}>
        {children}
      </div>
    )
  }
  return (
    <div
      className={`max-h-[min(60vh,22rem)] space-y-2.5 overflow-y-auto px-3 py-2.5 text-xs ${className}`}
    >
      {children}
    </div>
  )
}
