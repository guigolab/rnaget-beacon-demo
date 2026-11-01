'use client'

import type { ReactNode } from 'react'
import type { EntityRecordKind } from '@/lib/entity-record-sheet'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'

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
  const { openRecordSheet } = useEntityRecordSheet()

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
