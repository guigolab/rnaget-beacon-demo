import { Download } from 'lucide-react'
import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Shared horizontal bounds for nav, footer, and page content (was max-w-6xl). */
export const APP_MAX_WIDTH_CLASS = 'max-w-screen-2xl'

export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className={cn('mx-auto w-full px-4 py-8', APP_MAX_WIDTH_CLASS)}>{children}</div>
  )
}

export type PageHeaderDownloadItem = {
  label: string
  text: string
  href: string
  /** Hint browser to download (e.g. matrix file URL). */
  download?: boolean
}

export function PageHeaderDownloadButtons({
  items,
  className,
}: {
  items: PageHeaderDownloadItem[]
  className?: string
}) {
  if (!items.length) return null

  return (
    <div
      className={cn('flex flex-wrap gap-2', className)}
      role="group"
      aria-label="Downloads"
    >
      {items.map((item) => (
        <a
          key={`${item.label}-${item.href}`}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          download={item.download ? '' : undefined}
          title={`Download ${item.label}: ${item.text}`}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'h-auto max-w-[16rem] gap-2 py-2 pl-2.5 pr-3 text-left'
          )}
        >
          <Download className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-normal leading-tight text-muted-foreground">
              {item.label}
            </span>
            <span className="block truncate text-xs font-medium leading-snug text-foreground">
              {item.text}
            </span>
          </span>
        </a>
      ))}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  id,
  badges,
  legend,
  downloads,
}: {
  title: string
  description?: string
  id?: string
  badges?: ReactNode
  /** Bottom-aligned trailing content (e.g. filter-type dots). */
  legend?: ReactNode
  downloads?: PageHeaderDownloadItem[]
}) {
  return (
    <header className="border-b border-border pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {id && <p className="mt-1 font-mono text-xs text-muted-foreground">{id}</p>}
        </div>
        {badges ? <div className="flex flex-wrap gap-1.5 sm:justify-end">{badges}</div> : null}
      </div>
      {(description || legend) && (
        <div className="mt-2 flex items-end justify-between gap-4">
          {description ? (
            <p className="min-w-0 max-w-2xl flex-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {legend ? <div className="shrink-0 pb-0.5">{legend}</div> : null}
        </div>
      )}
      {downloads?.length ? (
        <PageHeaderDownloadButtons items={downloads} className="mt-4" />
      ) : null}
    </header>
  )
}

export function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="border border-dashed border-border px-4 py-8 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
