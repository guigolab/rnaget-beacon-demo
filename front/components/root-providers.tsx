'use client'

import type { ReactNode } from 'react'
import { EntityRecordSheetProvider } from '@/components/shared/entity-record-sheet-provider'

/** Global record sheet — must wrap any route that uses EntityRecordLink or useEntityRecordSheet. */
export function RootProviders({ children }: { children: ReactNode }) {
  return <EntityRecordSheetProvider>{children}</EntityRecordSheetProvider>
}
