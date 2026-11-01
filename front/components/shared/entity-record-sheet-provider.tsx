'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { EntityDetailPanel } from '@/components/entity-detail-panel'
import { ErrorNote, LoadingNote } from '@/components/status'
import { getBiosample, getFeature, type Biosample, type Feature } from '@/lib/beacon'
import { featureDisplayLabel } from '@/lib/gene-lens'
import { biosampleDisplayLabel } from '@/lib/sample-lens'
import {
  parseRecordSheetParams,
  replaceRecordSheetInBrowserUrl,
  type EntityRecordKind,
} from '@/lib/entity-record-sheet'

type RecordSheetTarget = { kind: EntityRecordKind; id: string }

type EntityRecordSheetContextValue = {
  openRecordSheet: (kind: EntityRecordKind, id: string) => void
  closeRecordSheet: () => void
}

const EntityRecordSheetContext = createContext<EntityRecordSheetContextValue | null>(null)

export function useEntityRecordSheetOptional(): EntityRecordSheetContextValue | null {
  return useContext(EntityRecordSheetContext)
}

export function useEntityRecordSheet(): EntityRecordSheetContextValue {
  const ctx = useEntityRecordSheetOptional()
  if (!ctx) {
    throw new Error('useEntityRecordSheet must be used within EntityRecordSheetProvider')
  }
  return ctx
}

function readTargetFromLocation(): RecordSheetTarget | null {
  if (typeof window === 'undefined') return null
  return parseRecordSheetParams(new URLSearchParams(window.location.search))
}

export function EntityRecordSheetProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [target, setTarget] = useState<RecordSheetTarget | null>(readTargetFromLocation)

  // Full navigations (link with ?recordKind=…) hydrate sheet state.
  useEffect(() => {
    setTarget(readTargetFromLocation())
  }, [pathname])

  useEffect(() => {
    const onPopState = () => setTarget(readTargetFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const openRecordSheet = useCallback(
    (nextKind: EntityRecordKind, id: string) => {
      const trimmed = id.trim()
      if (!trimmed) return
      const next: RecordSheetTarget = { kind: nextKind, id: trimmed }
      setTarget(next)
      replaceRecordSheetInBrowserUrl(pathname, next)
    },
    [pathname]
  )

  const closeRecordSheet = useCallback(() => {
    setTarget(null)
    replaceRecordSheetInBrowserUrl(pathname, null)
  }, [pathname])

  const contextValue = useMemo(
    () => ({ openRecordSheet, closeRecordSheet }),
    [openRecordSheet, closeRecordSheet]
  )

  return (
    <EntityRecordSheetContext.Provider value={contextValue}>
      {children}
      <EntityRecordSheetDialog target={target} onClose={closeRecordSheet} />
    </EntityRecordSheetContext.Provider>
  )
}

function EntityRecordSheetDialog({
  target,
  onClose,
}: {
  target: RecordSheetTarget | null
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<EntityRecordKind | null>(null)
  const [item, setItem] = useState<Feature | Biosample | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!target) {
      setOpen(false)
      setKind(null)
      setItem(null)
      setError('')
      setLoading(false)
      return
    }

    setOpen(true)
    setKind(target.kind)
    setItem(null)
    setError('')
    setLoading(true)

    let cancelled = false
    const load =
      target.kind === 'feature' ? getFeature(target.id) : getBiosample(target.id)

    load
      .then((row) => {
        if (cancelled) return
        if (!row) {
          setError(
            `${target.kind === 'feature' ? 'Feature' : 'Biosample'} '${target.id}' not found`
          )
          setItem(null)
        } else {
          setItem(row)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Cannot reach the beacon.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [target])

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/40" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-[101] flex h-full w-full max-w-lg flex-col border-l border-border bg-background shadow-xl outline-none">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
            <Dialog.Title className="truncate text-sm font-semibold text-foreground">
              {item && kind === 'feature'
                ? featureDisplayLabel(item as Feature)
                : item && kind === 'biosample'
                  ? biosampleDisplayLabel(item as Biosample)
                  : kind === 'feature'
                    ? 'Genomic feature'
                    : kind === 'biosample'
                      ? 'Biosample'
                      : 'Record'}
            </Dialog.Title>
            <Dialog.Close
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {loading && (
            <div className="flex flex-1 items-center justify-center p-8">
              <LoadingNote />
            </div>
          )}
          {!loading && error && (
            <div className="p-4">
              <ErrorNote message={error} />
            </div>
          )}
          {!loading && !error && item && kind && (
            <EntityDetailPanel kind={kind} item={item} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
