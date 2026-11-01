'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react'
import { useEntityRecordSheet } from '@/components/shared/entity-record-sheet-provider'
import {
  isAbortError,
  listExpressionValues,
  listMatrixBiosamples,
  listMatrixFeatures,
  matrixSearchParams,
  parseMatrixQuery,
  resolveBiosampleCohort,
  resolveFeatureCohort,
  type Biosample,
  type ExpressionValue,
  type Feature,
  type MatrixQuery,
  type ResolvedCohort,
  type UiFilter,
} from '@/lib/beacon'

const PAGE_ROWS = 10
const PAGE_COLS = 10
const MIN_CELL_W = 56
const CELL_H = 48
const CELL_GAP = 8
const PILL_RADIUS = 10
const ROW_LABEL_W = 176
const COL_HEADER_H = 76
const AXIS_BTN = 36

import {
  COLOR_HIGH,
  COLOR_HOVER,
  COLOR_LOW,
  COLOR_MID,
  COLOR_MID_LOW,
  COLOR_MISSING,
  COLOR_TOP,
} from '@/components/heatmap-colors'
import {
  cellKey,
  featureTokens,
  formatHeatmapValue,
  heatFill,
  heatTextColor,
  indexExpression,
  mergeFeatureExpressionCells,
  nativeFeatureId,
} from '@/lib/heatmap-expression'

function labelForFeature(feature: Feature) {
  return (
    feature.genomicFeature?.aliases?.[0] ??
    feature.genomicFeature?.featureIdentifier?.id ??
    feature.id
  )
}

function featureSecondary(feature: Feature) {
  const primary = labelForFeature(feature)
  const native = feature.genomicFeature?.featureIdentifier?.id
  if (native && native !== primary) return native
  return feature.id !== primary ? feature.id : undefined
}

function ontologyLabel(term?: { id?: string; label?: string } | string) {
  if (!term) return undefined
  if (typeof term === 'string') return term
  return term.label ?? term.id
}

function biosamplePrimary(sample: Biosample) {
  return ontologyLabel(sample.sampleOriginType) ?? ontologyLabel(sample.sampleType) ?? sample.id
}

function biosampleSecondary(sample: Biosample) {
  const primary = biosamplePrimary(sample)
  const candidates = [sample.summary, sample.notes, sample.description, sample.id].filter(
    (value): value is string => Boolean(value && value !== primary)
  )
  return candidates[0]
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function draftNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

type HoverCell = { row: number; col: number; clientX: number; clientY: number }

type Props = { matrixId: string }

export function MatrixHeatmap({ matrixId }: Props) {
  const { openRecordSheet } = useEntityRecordSheet()
  const searchParams = useSearchParams()
  const router = useRouter()
  const query = useMemo(() => parseMatrixQuery(searchParams), [searchParams])
  const queryKey = searchParams.toString()
  const cohortKey = useMemo(() => {
    return JSON.stringify({
      genes: query.genes,
      featureIds: query.featureIds,
      biosampleIds: query.biosampleIds,
    })
  }, [query])
  const needsFeatureCohort = query.genes.length > 0 || query.featureIds.length > 0
  const needsBioCohort = query.biosampleIds.length > 0

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridBodyRef = useRef<HTMLDivElement>(null)

  const [featureCohort, setFeatureCohort] = useState<
    ResolvedCohort<Feature> | null | undefined
  >(undefined)
  const [bioCohort, setBioCohort] = useState<ResolvedCohort<Biosample> | null | undefined>(
    undefined
  )
  const [featurePage, setFeaturePage] = useState<Feature[]>([])
  const [featureTotal, setFeatureTotal] = useState(0)
  const [bioPage, setBioPage] = useState<Biosample[]>([])
  const [bioTotal, setBioTotal] = useState(0)
  const [featuresReady, setFeaturesReady] = useState(false)
  const [biosamplesReady, setBiosamplesReady] = useState(false)
  const [rowSkip, setRowSkip] = useState(0)
  const [colSkip, setColSkip] = useState(0)
  const [values, setValues] = useState<Map<string, number>>(() => new Map())
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [featureQuery, setFeatureQuery] = useState('')
  const [minDraft, setMinDraft] = useState('')
  const [maxDraft, setMaxDraft] = useState('')
  const [hover, setHover] = useState<HoverCell | null>(null)
  const [pinned, setPinned] = useState<HoverCell | null>(null)
  const [cellW, setCellW] = useState(MIN_CELL_W)
  const cellWRef = useRef(cellW)
  cellWRef.current = cellW

  const cohortKeySeen = useRef<string | null>(null)
  const featureModeSeen = useRef(needsFeatureCohort)
  const bioModeSeen = useRef(needsBioCohort)
  if (cohortKeySeen.current !== cohortKey) {
    cohortKeySeen.current = cohortKey
    if (rowSkip !== 0) setRowSkip(0)
    if (colSkip !== 0) setColSkip(0)
  }
  if (featureModeSeen.current !== needsFeatureCohort) {
    featureModeSeen.current = needsFeatureCohort
    setFeaturesReady(false)
  }
  if (bioModeSeen.current !== needsBioCohort) {
    bioModeSeen.current = needsBioCohort
    setBiosamplesReady(false)
  }

  function replaceQuery(patch: Partial<MatrixQuery> & { filters?: UiFilter[] }) {
    const params = matrixSearchParams(searchParams, patch)
    const qs = params.toString()
    router.replace(
      qs
        ? `/matrices/${encodeURIComponent(matrixId)}/?${qs}`
        : `/matrices/${encodeURIComponent(matrixId)}/`
    )
  }

  useEffect(() => {
    setFeatureQuery(query.genes.join(', '))
    setMinDraft(query.minValue == null ? '' : String(query.minValue))
    setMaxDraft(query.maxValue == null ? '' : String(query.maxValue))
    setPinned(null)
    setHover(null)
  }, [queryKey, query])

  useEffect(() => {
    if (!needsFeatureCohort) {
      setFeatureCohort(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setFeaturesReady(false)
    setError('')
    resolveFeatureCohort({ ...query, filters: [] }, controller.signal)
      .then((cohort) => {
        if (cancelled) return
        setFeatureCohort(cohort ?? { items: [], total: 0 })
        setFeaturesReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setFeatureCohort({ items: [], total: 0 })
        setError(err instanceof Error ? err.message : 'Feature cohort failed')
        setFeaturesReady(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [needsFeatureCohort, cohortKey])

  useEffect(() => {
    if (!needsBioCohort) {
      setBioCohort(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setBiosamplesReady(false)
    resolveBiosampleCohort({ ...query, filters: [] }, controller.signal)
      .then((cohort) => {
        if (cancelled) return
        setBioCohort(cohort ?? { items: [], total: 0 })
        setBiosamplesReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setBioCohort({ items: [], total: 0 })
        setError(err instanceof Error ? err.message : 'Biosample cohort failed')
        setBiosamplesReady(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [needsBioCohort, cohortKey])

  useEffect(() => {
    if (needsFeatureCohort) return
    const controller = new AbortController()
    let cancelled = false
    listMatrixFeatures(matrixId, rowSkip, PAGE_ROWS, undefined, controller.signal)
      .then((page) => {
        if (cancelled) return
        setFeaturePage(page.results)
        setFeatureTotal(page.total ?? page.results.length)
        setFeaturesReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Failed to load features')
        setFeaturesReady(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [needsFeatureCohort, matrixId, rowSkip])

  useEffect(() => {
    if (needsBioCohort) return
    const controller = new AbortController()
    let cancelled = false
    listMatrixBiosamples(matrixId, colSkip, PAGE_COLS, controller.signal)
      .then((page) => {
        if (cancelled) return
        setBioPage(page.results)
        setBioTotal(page.total ?? page.results.length)
        setBiosamplesReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Failed to load biosamples')
        setBiosamplesReady(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [colSkip, matrixId, needsBioCohort])

  const pageFeatures = useMemo(
    () =>
      featureCohort
        ? featureCohort.items.slice(rowSkip, rowSkip + PAGE_ROWS)
        : featurePage,
    [featureCohort, featurePage, rowSkip]
  )
  const pageBiosamples = useMemo(
    () => (bioCohort ? bioCohort.items.slice(colSkip, colSkip + PAGE_COLS) : bioPage),
    [bioCohort, bioPage, colSkip]
  )
  const rowTotal = featureCohort ? featureCohort.items.length : featureTotal
  const columnTotal = bioCohort ? bioCohort.items.length : bioTotal
  const visibleKey = `${pageFeatures.map(nativeFeatureId).join('|')}::${pageBiosamples
    .map((sample) => sample.id)
    .join('|')}::${query.minValue ?? ''}::${query.maxValue ?? ''}`

  useEffect(() => {
    if (!featuresReady || !biosamplesReady) return
    if (!pageFeatures.length || !pageBiosamples.length) {
      setValues(new Map())
      return
    }
    const controller = new AbortController()
    let cancelled = false
    const biosampleIDList = pageBiosamples.map((sample) => sample.id).join(',')
    const featureIDList = (
      featureCohort
        ? [...new Set(pageFeatures.flatMap(featureTokens))]
        : pageFeatures.map(nativeFeatureId)
    )
      .slice(0, 100)
      .join(',')
    const limit = featureCohort
      ? Math.min(1000, Math.max(pageFeatures.length * pageBiosamples.length, 1) * 4)
      : Math.max(pageFeatures.length * pageBiosamples.length, 1)
    setFetching(true)

    const apply = (rows: ExpressionValue[], features: Feature[]) => {
      const indexed = indexExpression(features, rows)
      return indexed
    }

    listExpressionValues(matrixId, {
      skip: 0,
      limit,
      featureIDList,
      biosampleIDList,
      minValue: query.minValue,
      maxValue: query.maxValue,
      signal: controller.signal,
    })
      .then(async (data) => {
        if (cancelled) return
        const indexed = apply(data.results, pageFeatures)
        if (!indexed.unmatched.length) {
          setValues(indexed.values)
          return
        }
        const extra = await Promise.all(
          indexed.unmatched.map((feature) =>
            listExpressionValues(matrixId, {
              skip: 0,
              limit: Math.min(1000, pageBiosamples.length * 4),
              featureIDList: featureTokens(feature).join(','),
              biosampleIDList,
              minValue: query.minValue,
              maxValue: query.maxValue,
              signal: controller.signal,
            })
          )
        )
        if (cancelled) return
        const values = indexed.values
        indexed.unmatched.forEach((feature, index) => {
          const rows = extra[index]?.results ?? []
          for (const id of new Set(rows.map((row) => row.featureId))) {
            const cells = new Map<string, number>()
            for (const row of rows) {
              if (row.featureId !== id) continue
              const prev = cells.get(row.biosampleId)
              if (prev == null || row.value > prev) cells.set(row.biosampleId, row.value)
            }
            mergeFeatureExpressionCells(values, feature, cells)
          }
        })
        setValues(new Map(values))
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return
        setError(err instanceof Error ? err.message : 'Expression fetch failed')
      })
      .finally(() => {
        if (!cancelled) setFetching(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
    // visibleKey captures the page contents and value range
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, featuresReady, biosamplesReady, matrixId])

  const range = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const feature of pageFeatures) {
      const fid = nativeFeatureId(feature)
      for (const sample of pageBiosamples) {
        const value = values.get(cellKey(fid, sample.id))
        if (value === undefined) continue
        if (value < min) min = value
        if (value > max) max = value
      }
    }
    if (!Number.isFinite(min)) return { min: 0, max: 0 }
    return { min, max }
  }, [values, pageFeatures, pageBiosamples])

  const cols = Math.max(1, pageBiosamples.length)
  const rows = Math.max(1, pageFeatures.length)
  const canvasW = cols * cellW
  const canvasH = rows * CELL_H
  const loading = !featuresReady || !biosamplesReady

  useEffect(() => {
    const el = gridBodyRef.current
    if (!el) return
    const update = () => {
      const n = Math.max(1, pageBiosamples.length)
      const w = el.clientWidth
      setCellW(Math.max(MIN_CELL_W, Math.floor(w / n)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [pageBiosamples.length, loading])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pageFeatures.length || !pageBiosamples.length) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(canvasW * dpr))
    canvas.height = Math.max(1, Math.floor(canvasH * dpr))
    canvas.style.width = `${canvasW}px`
    canvas.style.height = `${canvasH}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvasW, canvasH)

    const active = pinned ?? hover
    const cw = cellW

    for (let r = 0; r < pageFeatures.length; r++) {
      const feature = pageFeatures[r]
      if (!feature) continue
      const fid = nativeFeatureId(feature)
      if (r > 0) {
        ctx.strokeStyle = '#edf2f3'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, r * CELL_H)
        ctx.lineTo(canvasW, r * CELL_H)
        ctx.stroke()
      }
      for (let c = 0; c < pageBiosamples.length; c++) {
        const sample = pageBiosamples[c]
        if (!sample) continue
        const value = values.get(cellKey(fid, sample.id))
        const x = c * cw + CELL_GAP / 2
        const y = r * CELL_H + CELL_GAP / 2
        const w = cw - CELL_GAP
        const h = CELL_H - CELL_GAP

        roundRect(ctx, x, y, w, h, PILL_RADIUS)
        ctx.fillStyle = value === undefined ? COLOR_MISSING : heatFill(value, range.min, range.max)
        ctx.fill()

        if (active && active.row === r && active.col === c) {
          ctx.strokeStyle = COLOR_HOVER
          ctx.lineWidth = 2
          roundRect(ctx, x + 1, y + 1, w - 2, h - 2, PILL_RADIUS - 1)
          ctx.stroke()
        }

        const label = value === undefined ? '—' : formatHeatmapValue(value)
        ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle =
          value === undefined ? '#829198' : heatTextColor(value, range.min, range.max)
        ctx.fillText(label, x + w / 2, y + h / 2)
      }
    }
  }, [
    canvasW,
    canvasH,
    cellW,
    pageFeatures,
    pageBiosamples,
    values,
    range,
    hover,
    pinned,
  ])

  function hitTest(clientX: number, clientY: number): HoverCell | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const cw = cellWRef.current
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (x < 0 || y < 0 || x >= canvasW || y >= canvasH) return null
    const col = Math.floor(x / cw)
    const row = Math.floor(y / CELL_H)
    if (row < 0 || col < 0 || row >= pageFeatures.length || col >= pageBiosamples.length) {
      return null
    }
    return { row, col, clientX, clientY }
  }

  const tip = pinned ?? hover
  const tipFeature = tip ? pageFeatures[tip.row] : undefined
  const tipSample = tip ? pageBiosamples[tip.col] : undefined
  const tipValue =
    tipFeature && tipSample
      ? values.get(cellKey(nativeFeatureId(tipFeature), tipSample.id))
      : undefined

  const maxRowSkip = Math.max(0, rowTotal - PAGE_ROWS)
  const maxColSkip = Math.max(0, columnTotal - PAGE_COLS)
  const rowFrom = rowTotal ? rowSkip + 1 : 0
  const rowTo = Math.min(rowSkip + PAGE_ROWS, rowTotal)
  const colFrom = columnTotal ? colSkip + 1 : 0
  const colTo = Math.min(colSkip + PAGE_COLS, columnTotal)

  function applyForm() {
    const tokens = featureQuery
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
    const minValue = draftNumber(minDraft)
    const maxValue = draftNumber(maxDraft)
    if (minDraft.trim() && minValue == null) {
      setError('Minimum value must be a number')
      return
    }
    if (maxDraft.trim() && maxValue == null) {
      setError('Maximum value must be a number')
      return
    }
    setError('')
    replaceQuery({
      genes: tokens,
      ...(tokens.length ? { featureIds: [] } : {}),
      filters: [],
      minValue,
      maxValue,
    })
  }

  function ArrowBtn({
    label,
    disabled,
    onClick,
    children,
  }: {
    label: string
    disabled: boolean
    onClick: () => void
    children: ReactNode
  }) {
    return (
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-[#cbd9de] bg-white text-[#405761] transition hover:border-[#0c7c86] hover:text-[#0c7c86] disabled:cursor-not-allowed disabled:opacity-35"
      >
        {children}
      </button>
    )
  }

  const featureCap =
    featureCohort && featureCohort.total > featureCohort.items.length
      ? featureCohort.total
      : null
  const biosampleCap =
    bioCohort && bioCohort.total > bioCohort.items.length ? bioCohort.total : null

  return (
    <section className="mt-6">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1.4fr)_8rem_8rem_auto]">
        <label className="text-xs font-medium text-[#405761]">
          Features
          <input
            value={featureQuery}
            onChange={(event) => setFeatureQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyForm()
            }}
            placeholder="TP53, BRCA1, ENSG…"
            className="mt-1.5 h-10 w-full rounded-md border border-[#cbd9de] bg-white px-3 font-mono text-sm outline-none ring-[#0c7c86] focus:ring-2"
          />
        </label>
        <label className="text-xs font-medium text-[#405761]">
          Minimum
          <input
            value={minDraft}
            onChange={(event) => setMinDraft(event.target.value)}
            inputMode="decimal"
            className="mt-1.5 h-10 w-full rounded-md border border-[#cbd9de] bg-white px-3 text-sm outline-none ring-[#0c7c86] focus:ring-2"
          />
        </label>
        <label className="text-xs font-medium text-[#405761]">
          Maximum
          <input
            value={maxDraft}
            onChange={(event) => setMaxDraft(event.target.value)}
            inputMode="decimal"
            className="mt-1.5 h-10 w-full rounded-md border border-[#cbd9de] bg-white px-3 text-sm outline-none ring-[#0c7c86] focus:ring-2"
          />
        </label>
        <button
          type="button"
          onClick={applyForm}
          className="h-10 rounded-md bg-[#0c7c86] px-4 text-sm font-semibold text-white hover:bg-[#095f67]"
        >
          Apply
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-[#829198]">
          genes {rowFrom}–{rowTo}
          {rowTotal ? ` / ${rowTotal.toLocaleString()}` : ''}
          {' · '}
          samples {colFrom}–{colTo}
          {columnTotal ? ` / ${columnTotal.toLocaleString()}` : ''}
          {fetching && ' · updating…'}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[#829198]">low</span>
          <div
            className="h-2.5 w-32 rounded-sm"
            style={{
              background: `linear-gradient(90deg, ${COLOR_LOW}, ${COLOR_MID_LOW}, ${COLOR_MID}, ${COLOR_HIGH}, ${COLOR_TOP})`,
            }}
          />
          <span className="text-[10px] uppercase tracking-wider text-[#829198]">high</span>
        </div>
      </div>

      {(query.featureIds.length > 0 || query.biosampleIds.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {query.featureIds.length > 0 && (
            <button
              type="button"
              onClick={() => replaceQuery({ featureIds: [] })}
              className="rounded-full bg-[#e7f3f2] px-3 py-1 text-xs text-[#0c6870]"
            >
              {query.featureIds.length} feature id{query.featureIds.length === 1 ? '' : 's'} ×
            </button>
          )}
          {query.biosampleIds.length > 0 && (
            <button
              type="button"
              onClick={() => replaceQuery({ biosampleIds: [] })}
              className="rounded-full bg-[#e7f3f2] px-3 py-1 text-xs text-[#0c6870]"
            >
              {query.biosampleIds.length} biosample id
              {query.biosampleIds.length === 1 ? '' : 's'} ×
            </button>
          )}
        </div>
      )}
      {(featureCap != null || biosampleCap != null) && (
        <p className="mb-3 text-xs text-[#829198]">
          Cohort is capped at 100 ids
          {featureCap != null ? ` (${featureCap.toLocaleString()} features matched)` : ''}
          {biosampleCap != null ? ` (${biosampleCap.toLocaleString()} biosamples matched)` : ''}.
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-[#71818a]">Loading heatmap…</p>
      ) : !pageFeatures.length || !pageBiosamples.length ? (
        <p className="text-sm text-[#71818a]">
          No {pageFeatures.length ? 'biosamples' : 'features'} in this view. Relax the filters or
          clear the cohort.
        </p>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-[#dce7ea] bg-white">
          <div
            className="grid w-full"
            style={{
              gridTemplateColumns: `${ROW_LABEL_W}px ${AXIS_BTN}px minmax(0, 1fr) ${AXIS_BTN}px`,
              gridTemplateRows: `${COL_HEADER_H}px auto auto`,
            }}
          >
            <div className="relative z-0 flex flex-col items-center justify-between border-b border-r border-[#dce7ea] bg-[#f7faf9] px-2 py-2">
              <p className="w-full text-[10px] font-semibold uppercase tracking-wider text-[#829198]">
                Feature / id
              </p>
              <ArrowBtn
                label="Previous genes"
                disabled={rowSkip <= 0}
                onClick={() => setRowSkip((offset) => Math.max(0, offset - PAGE_ROWS))}
              >
                <ChevronUp className="size-4" />
              </ArrowBtn>
            </div>
            <div className="relative z-0 flex items-center justify-center border-b border-[#dce7ea] bg-[#f7faf9]">
              <ArrowBtn
                label="Previous biosamples"
                disabled={colSkip <= 0}
                onClick={() => setColSkip((offset) => Math.max(0, offset - PAGE_COLS))}
              >
                <ChevronLeft className="size-4" />
              </ArrowBtn>
            </div>
            <div className="relative z-0 flex border-b border-[#dce7ea] bg-[#f7faf9]">
              {pageBiosamples.map((sample) => {
                const primary = biosamplePrimary(sample)
                const secondary = biosampleSecondary(sample)
                return (
                  <div
                    key={sample.id}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end overflow-hidden px-1 pb-2 text-center"
                    title={[primary, secondary, sample.id].filter(Boolean).join('\n')}
                  >
                    <p className="w-full truncate text-[11px] font-semibold uppercase tracking-wide text-[#405761]">
                      {primary}
                    </p>
                    {secondary && (
                      <p className="w-full truncate text-[9px] text-[#829198]">{secondary}</p>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="relative z-0 flex items-center justify-center border-b border-l border-[#dce7ea] bg-[#f7faf9]">
              <ArrowBtn
                label="Next biosamples"
                disabled={colSkip >= maxColSkip}
                onClick={() => setColSkip((offset) => Math.min(maxColSkip, offset + PAGE_COLS))}
              >
                <ChevronRight className="size-4" />
              </ArrowBtn>
            </div>
            <div className="relative z-0 flex flex-col border-r border-[#dce7ea] bg-white">
              {pageFeatures.map((feature) => (
                <div
                  key={feature.id}
                  className="flex flex-col justify-center border-b border-[#edf2f3] px-3 last:border-0"
                  style={{ height: CELL_H }}
                  title={[labelForFeature(feature), featureSecondary(feature)]
                    .filter(Boolean)
                    .join('\n')}
                >
                  <p className="truncate text-sm font-semibold text-[#20353d]">
                    {labelForFeature(feature)}
                  </p>
                  {featureSecondary(feature) && (
                    <p className="truncate font-mono text-[10px] text-[#829198]">
                      {featureSecondary(feature)}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="border-r border-[#edf2f3] bg-white" />
            <div ref={gridBodyRef} className="relative z-0 min-w-0 w-full">
              <canvas
                ref={canvasRef}
                className="block cursor-pointer"
                style={{ width: canvasW, height: canvasH }}
                onMouseMove={(event) => {
                  if (pinned) return
                  setHover(hitTest(event.clientX, event.clientY))
                }}
                onMouseLeave={() => {
                  if (!pinned) setHover(null)
                }}
                onClick={(event) => {
                  const hit = hitTest(event.clientX, event.clientY)
                  if (pinned && hit && pinned.row === hit.row && pinned.col === hit.col) {
                    setPinned(null)
                    return
                  }
                  setPinned(hit)
                  setHover(hit)
                }}
              />
            </div>
            <div className="border-l border-[#edf2f3] bg-white" />
            <div className="relative z-0 flex items-center justify-center border-t border-r border-[#edf2f3] bg-[#f7faf9] py-2">
              <ArrowBtn
                label="Next genes"
                disabled={rowSkip >= maxRowSkip}
                onClick={() => setRowSkip((offset) => Math.min(maxRowSkip, offset + PAGE_ROWS))}
              >
                <ChevronDown className="size-4" />
              </ArrowBtn>
            </div>
            <div className="border-t border-[#edf2f3] bg-[#f7faf9]" />
            <div className="border-t border-[#edf2f3] bg-[#f7faf9]" />
            <div className="border-t border-[#edf2f3] bg-[#f7faf9]" />
          </div>
          {tip && tipFeature && tipSample && (
            <div
              className={`fixed z-[200] max-w-xs rounded-md border border-[#dce7ea] bg-white px-3 py-2 text-xs shadow-md ${
                pinned ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
              style={{
                left: tip.clientX,
                top: tip.clientY - 12,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <p className="font-semibold text-[#20353d]">{labelForFeature(tipFeature)}</p>
              <p className="mt-0.5 text-[#71818a]">
                {biosamplePrimary(tipSample)}
                {biosampleSecondary(tipSample) ? ` · ${biosampleSecondary(tipSample)}` : ''}
              </p>
              <p className="mt-1 font-mono text-[#0c7c86]">
                {tipValue === undefined ? '—' : formatHeatmapValue(tipValue)}
              </p>
              {pinned && (
                <p className="mt-2 flex gap-3">
                  <button
                    type="button"
                    className="text-[#0c6870] underline"
                    onClick={() => openRecordSheet('feature', tipFeature.id)}
                  >
                    Feature
                  </button>
                  <button
                    type="button"
                    className="text-[#0c6870] underline"
                    onClick={() => openRecordSheet('biosample', tipSample.id)}
                  >
                    Biosample
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
