import Link from 'next/link'
import type { ReactNode } from 'react'

export function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl px-5 py-10">{children}</div>
}

export function PageHeader({
  eyebrow,
  title,
  description,
  id,
}: {
  eyebrow?: string
  title: string
  description?: string
  id?: string
}) {
  return (
    <header>
      {eyebrow && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#0c7c86]">
          {eyebrow}
        </p>
      )}
      <h1 className="font-serif text-4xl tracking-tight text-[#15232c]">{title}</h1>
      {id && <p className="mt-2 font-mono text-xs text-[#829198]">{id}</p>}
      {description && (
        <p className="mt-4 max-w-2xl text-base leading-7 text-[#667780]">{description}</p>
      )}
    </header>
  )
}

export function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return <PageHeader eyebrow={eyebrow} title={title} description={description} />
}

export function EndpointNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 font-mono text-[11px] leading-5 text-[#829198]">{children}</p>
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[#cbd9de] bg-white px-3 py-1 text-xs text-[#405761]">
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
      className="rounded-full bg-[#e7f3f2] px-3 py-1 text-xs text-[#0c6870]"
    >
      {label}
      <span className="ml-2 text-[#829198]">×</span>
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
    <section className="rounded-xl border border-[#dce7ea] bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#829198]">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[#71818a]">No additional fields.</p>
      ) : (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {rows.map((fact) => (
            <div
              key={fact.label}
              className={
                fact.label === 'Description' || fact.label === 'Notes' ? 'sm:col-span-2' : undefined
              }
            >
              <dt className="text-xs text-[#829198]">{fact.label}</dt>
              <dd className="mt-1 text-sm leading-6 text-[#1f343d]">
                {fact.links && fact.links.length > 0 ? (
                  <span className="flex flex-col gap-1">
                    {fact.links.map((link) =>
                      link.href ? (
                        <a
                          key={`${link.text}:${link.href}`}
                          href={link.href}
                          className="text-[#0c6870] underline decoration-[#b7d5d2] underline-offset-2 hover:text-[#0c7c86]"
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
    <div className="rounded-xl border border-dashed border-[#cbd9de] bg-white px-6 py-12 text-center">
      <p className="font-medium text-[#2a3b44]">{title}</p>
      <p className="mt-2 text-sm text-[#73838a]">{description}</p>
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
    <div className="mt-6 flex items-center justify-between border-t border-[#e2eaed] pt-4 text-sm">
      <span className="text-[#75858d]">
        {total ? `${skip + 1}–${Math.min(skip + limit, total)} of ${total}` : 'No results'}
      </span>
      <div className="flex gap-2">
        {prev ? (
          <Link
            className="rounded-md border border-[#cad8dc] bg-white px-3 py-1.5 hover:bg-[#edf5f5]"
            href={prev}
          >
            Previous
          </Link>
        ) : (
          <span className="rounded-md border border-[#edf0f1] px-3 py-1.5 text-[#b0bdc1]">
            Previous
          </span>
        )}
        {next ? (
          <Link
            className="rounded-md border border-[#cad8dc] bg-white px-3 py-1.5 hover:bg-[#edf5f5]"
            href={next}
          >
            Next
          </Link>
        ) : (
          <span className="rounded-md border border-[#edf0f1] px-3 py-1.5 text-[#b0bdc1]">
            Next
          </span>
        )}
      </div>
    </div>
  )
}
