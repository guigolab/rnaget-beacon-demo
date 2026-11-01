'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ApiDrawer } from '@/components/api-drawer'
import { EntityRecordSheetProvider } from '@/components/shared/entity-record-sheet-provider'

const links = [
  { href: '/features/', label: 'Features' },
  { href: '/biosamples/', label: 'Biosamples' },
  { href: '/matrices/', label: 'Matrices' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <EntityRecordSheetProvider>
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="font-semibold text-foreground">
            RNA-Get Beacon
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {links.map((link) => {
              const active = pathname.startsWith(link.href.replace(/\?.*$/, ''))
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2 py-1 ${active ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mx-auto max-w-6xl border-t border-border px-4 py-6 text-xs text-muted-foreground">
        Beacon v2 demo · API-backed views
      </footer>
      <ApiDrawer />
    </div>
    </EntityRecordSheetProvider>
  )
}
