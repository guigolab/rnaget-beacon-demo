'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp } from 'lucide-react'

/** Help popover summarising how the percentiles behind the heatmap are computed. */
export function PercentileHelp() {
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
      const w = Math.min(448, window.innerWidth * 0.85)
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
        aria-label="How percentiles are computed"
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
          className="fixed z-50 max-h-[calc(100vh-16px)] w-[min(28rem,85vw)] overflow-y-auto rounded-lg border border-border bg-card p-4 text-xs normal-case tracking-normal text-foreground shadow-lg"
        >
          <h3 className="mb-2 text-sm font-semibold">How percentiles are computed</h3>
          <p className="mb-2 font-medium">Tissue-specific (heatmap bands)</p>
          <ul className="mb-3 list-disc space-y-1 pl-4 text-muted-foreground">
            <li>Each sample belongs to one tissue column (its UBERON/EFO id).</li>
            <li>
              For every gene and tissue we take the <b>median</b> expression over that
              tissue&apos;s samples, per matrix.
            </li>
            <li>
              Genes with median &gt; 0 are ranked within the tissue:{' '}
              <code>percent_rank × 100</code>. Median 0 means measured but not detected.
            </li>
            <li>
              <code>tissue.percentile:&lt;tissue&gt; &gt;= 99</code> = top 1% (the
              &ldquo;top 1%&rdquo; band); <code>&gt;= 0</code> = detected (&ldquo;present&rdquo;);
              no row = not measured in any matrix.
            </li>
            <li>
              Across matrices, the one with the most samples for that tissue wins.
            </li>
          </ul>
          <p className="mb-2 font-medium">Not tissue-specific</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            <li>
              <code>expression.percentile</code> (90/95/99): rank of a gene&apos;s median
              among detected genes of a matrix; at the root, a gene matches if any matrix
              meets the threshold.
            </li>
            <li>
              Cell level: <code>percentileInFeature</code> ranks a value among that
              gene&apos;s samples; <code>percentileInBiosample</code> among that
              sample&apos;s genes.
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            Percentiles are relative to each tissue&apos;s own gene set, so tissues with few
            samples are not directly comparable to large ones.
          </p>
        </div>,
        document.body
      )}
    </div>
  )
}
