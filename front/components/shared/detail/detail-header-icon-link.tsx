'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

type DetailHeaderIconLinkProps = {
  href?: string
  onClick?: () => void
  label: string
  className?: string
}

const btnClass =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function DetailHeaderIconLink({
  href,
  onClick,
  label,
  className = '',
}: DetailHeaderIconLinkProps) {
  const icon = <ExternalLink className="size-4" aria-hidden />

  if (href) {
    return (
      <Link
        href={href}
        className={`${btnClass} ${className}`}
        title={label}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
      >
        {icon}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={`${btnClass} ${className}`}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      {icon}
    </button>
  )
}
