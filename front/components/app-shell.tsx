'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dna } from 'lucide-react'
import { ApiDrawer } from '@/components/api-drawer'

const links = [
  { href: '/datasets', label: 'Datasets' },
  { href: '/genes/TP53', label: 'Gene lens' },
  { href: '/samples', label: 'Samples' },
  { href: '/compare', label: 'Compare' },
  { href: '/matrices', label: 'Matrices' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="min-h-screen bg-[#f8fafb] text-[#15232c]">
      <header className="border-b border-[#dfe7eb] bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-[#0c7c86] text-white">
              <Dna aria-hidden="true" />
            </span>
            <span>RNA-Get</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm text-[#60717b]">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-2 transition hover:bg-[#edf5f5] hover:text-[#0c6870] ${
                  pathname.startsWith(link.href) ? 'bg-[#edf5f5] text-[#0c6870]' : ''
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <ApiDrawer />
      <footer className="mx-auto flex max-w-6xl items-center justify-between border-t border-[#dfe7eb] px-5 py-8 text-xs text-[#75858d]">
        <span>RNA-Get Explorer · Beacon v2 demo</span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[#3a9b91]" />
          Live API
        </span>
      </footer>
    </div>
  )
}
