'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import type { EntityRecordKind } from '@/lib/entity-record-sheet'
import { recordSheetSearchParams } from '@/lib/entity-record-sheet'
import { useEntityRecordSheetOptional } from '@/components/shared/entity-record-sheet-provider'

type EntityRecordLinkProps = {
  kind: EntityRecordKind
  id: string
  children: ReactNode
  className?: string
  title?: string
  /** e.g. close a popover after opening the sheet */
  onActivate?: () => void
}

/** Opens the global entity record sheet (does not navigate away). */
export function EntityRecordLink({
  kind,
  id,
  children,
  className,
  title,
  onActivate,
}: EntityRecordLinkProps) {
  const sheet = useEntityRecordSheetOptional()
  const pathname = usePathname()
  const search = useSearchParams()

  if (sheet) {
    const { openRecordSheet } = sheet
    return (
      <button
        type="button"
        title={title}
        className={className}
        onClick={(e) => {
          e.stopPropagation()
          openRecordSheet(kind, id)
          onActivate?.()
        }}
      >
        {children}
      </button>
    )
  }

  const params = recordSheetSearchParams(search, { kind, id })
  const href = `${pathname}?${params.toString()}`

  return (
    <Link
      href={href}
      title={title}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        onActivate?.()
      }}
    >
      {children}
    </Link>
  )
}
