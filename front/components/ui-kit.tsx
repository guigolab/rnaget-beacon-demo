import Link from 'next/link'
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
  downloads,
}: {
  title: string
  description?: string
  id?: string
  badges?: ReactNode
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
      {description && (
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      )}
      {downloads?.length ? (
        <PageHeaderDownloadButtons items={downloads} className="mt-4" />
      ) : null}
    </header>
  )
}

/** @deprecated use PageHeader */
export function PageIntro({
  eyebrow: _eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return <PageHeader title={title} description={description} />
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="border border-border bg-background px-2 py-0.5 text-xs text-foreground">
      {children}
    </span>
  )
}

export function FilterChip({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      title="Remove filter"
      className="border border-border bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-accent"
    >
      {label}
      <span className="ml-1 text-muted-foreground">×</span>
    </button>
  )
}

export type FactLink = { text: string; href?: string }

export function RecordFacts({
  title,
  facts,
}: {
  title: string
  facts: Array<{ label: string; value?: string | null; links?: FactLink[] }>
}) {
  const rows = facts.filter(
    (fact) => (fact.value && fact.value.trim()) || (fact.links && fact.links.length > 0)
  )
  return (
    <section className="border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No additional fields.</p>
      ) : (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {rows.map((fact) => (
            <div
              key={fact.label}
              className={
                fact.label === 'Description' || fact.label === 'Notes' ? 'sm:col-span-2' : undefined
              }
            >
              <dt className="text-xs text-muted-foreground">{fact.label}</dt>
              <dd className="mt-0.5 text-sm text-foreground">
                {fact.links && fact.links.length > 0 ? (
                  <span className="flex flex-col gap-1">
                    {fact.links.map((link) =>
                      link.href ? (
                        <a
                          key={`${link.text}:${link.href}`}
                          href={link.href}
                          className="text-primary underline underline-offset-2"
                        >
                          {link.text}
                        </a>
                      ) : (
                        <span key={link.text}>{link.text}</span>
                      )
                    )}
                  </span>
                ) : (
                  fact.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
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

export function Pagination({
  skip,
  limit,
  total,
  href,
}: {
  skip: number
  limit: number
  total: number
  href: (skip: number) => string
}) {
  const prev = skip > 0 ? href(Math.max(0, skip - limit)) : null
  const next = skip + limit < total ? href(skip + limit) : null
  return (
    <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
      <span className="text-muted-foreground">
        {total ? `${skip + 1}–${Math.min(skip + limit, total)} of ${total}` : 'No results'}
      </span>
      <div className="flex gap-2">
        {prev ? (
          <Link className="border border-border px-2 py-1 hover:bg-muted" href={prev}>
            Previous
          </Link>
        ) : (
          <span className="border border-border px-2 py-1 text-muted-foreground">Previous</span>
        )}
        {next ? (
          <Link className="border border-border px-2 py-1 hover:bg-muted" href={next}>
            Next
          </Link>
        ) : (
          <span className="border border-border px-2 py-1 text-muted-foreground">Next</span>
        )}
      </div>
    </div>
  )
}

export function DataTable({
  head,
  children,
}: {
  head: string[]
  children: ReactNode
}) {
  return (
    <div className="mt-4 overflow-x-auto border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  )
}
