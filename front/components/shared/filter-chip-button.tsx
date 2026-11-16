'use client'

import type { CSSProperties } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FilterChipButton({
  label,
  title,
  mono,
  style,
  onRemove,
}: {
  label: string
  title?: string
  mono?: boolean
  /** Term-type colours (ontology / alphanumeric); defaults to the neutral chip. */
  style?: CSSProperties
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      title={title ?? `Remove ${label}`}
      style={style}
      className={cn(
        'inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-border bg-muted/80 py-0.5 pl-2 pr-1 text-sm font-medium hover:bg-muted',
        mono && 'font-mono'
      )}
      onClick={(event) => {
        event.stopPropagation()
        onRemove()
      }}
    >
      <span className="truncate">{label}</span>
      <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">Remove {label}</span>
    </button>
  )
}
