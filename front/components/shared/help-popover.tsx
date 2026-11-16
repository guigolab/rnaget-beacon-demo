'use client'

import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'

/** Help popover summarising how the percentiles behind the heatmap are computed. */
export function HelpPopover({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Position in viewport coordinates; the panel is portaled to <body> so
  // ancestor `overflow-hidden` cards cannot clip it.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect()
      if (!b) return
      const w = Math.min(480, window.innerWidth * 0.88)
      const left = Math.max(8, Math.min(b.left, window.innerWidth - w - 8))
      const h = panelRef.current?.offsetHeight ?? 0
      let top = b.bottom + 6
      if (h && top + h > window.innerHeight - 8) {
        top = Math.max(8, b.top - h - 6)
      }
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <CircleHelp className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
        <div
          ref={panelRef}
          role="dialog"
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className="fixed z-50 max-h-[calc(100vh-16px)] w-[min(30rem,88vw)] overflow-y-auto rounded-lg border border-border bg-card p-4 text-[13px] leading-relaxed normal-case tracking-normal text-foreground shadow-lg"
        >
          <h3 className="mb-2 text-sm font-semibold">{title}</h3>
          {children}
        </div>,
        document.body
      )}
    </div>
  )
}

/** Titled block inside a help popover. */
export function HelpSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mt-3 border-t border-border pt-3 first:mt-0 first:border-0 first:pt-0">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}
