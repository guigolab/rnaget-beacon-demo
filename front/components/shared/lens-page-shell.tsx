'use client'

import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { LoadingNote } from '@/components/status'

export function LensPageShell({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <Suspense fallback={<LoadingNote />}>{children}</Suspense>
    </AppShell>
  )
}
