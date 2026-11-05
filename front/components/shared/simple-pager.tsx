'use client'

import { Button } from '@/components/ui/button'
import type { PagedList } from '@/hooks/use-paged-list'
import { cn } from '@/lib/utils'

type SimplePagerProps = {
  pager: Pick<
    PagedList<unknown>,
    'total' | 'start' | 'end' | 'canPrev' | 'canNext' | 'prev' | 'next'
  >
  className?: string
  label?: string
}

export function SimplePager({ pager, className, label }: SimplePagerProps) {
  if (pager.total === 0) return null

  const range =
    pager.total === 0
      ? '0 of 0'
      : `${pager.start + 1}–${pager.end} of ${pager.total.toLocaleString()}`

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2',
        className
      )}
    >
      <p className="text-xs text-muted-foreground">
        {label ? `${label} · ${range}` : range}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!pager.canPrev}
          onClick={pager.prev}
        >
          Prev
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!pager.canNext}
          onClick={pager.next}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
