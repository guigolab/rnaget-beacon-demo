'use client'

import {
  useCallback,
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
  Search,
} from 'lucide-react'
import {
  listExpressionValues,
  listMatrixBiosamples,
  listMatrixFeatures,
  type Biosample,
  type Feature,
} from '@/lib/rnaget'

const FEATURE_PAGE = 100
const INITIAL_FEATURES = 80
const BIOSAMPLE_CATALOG_LIMIT = 1000
const MAX_FEATURES_PER_REQUEST = 32
const MAX_SAMPLES_PER_REQUEST = 32
const EXPR_LIMIT = 1000

const PAGE_ROWS = 10
const PAGE_COLS = 10
const MIN_CELL_W = 56
const CELL_H = 48
const CELL_GAP = 8
const PILL_RADIUS = 10
const ROW_LABEL_W = 176
const COL_HEADER_H = 76
const AXIS_BTN = 36

const COLOR_LOW = '#f7faf9'
const COLOR_MID_LOW = '#c9e5e5'
const COLOR_MID = '#0c7c86'
const COLOR_HIGH = '#095f67'
const COLOR_TOP = '#20353d'
const COLOR_MISSING = '#edf2f3'
const COLOR_TEXT_DARK = '#20353d'
const COLOR_TEXT_LIGHT = '#ffffff'
const COLOR_HOVER = '#0c7c86'

function nativeFeatureId(feature: Feature) {
  return feature.genomicFeature?.featureIdentifier?.id ?? feature.id
}

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

function biosamplePrimary(b: Biosample) {
  return (
    ontologyLabel(b.sampleOriginType) ??
    ontologyLabel(b.sampleType) ??
    b.id
  )
}

function biosampleSecondary(b: Biosample) {
  const primary = biosamplePrimary(b)
  const candidates = [b.summary, b.notes, b.description, b.id].filter(
    (v): v is string => Boolean(v && v !== primary)
  )
  return candidates[0]
}

function cellKey(featureId: string, biosampleId: string) {
  return `${featureId}:${biosampleId}`
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function mix(a: string, b: string, t: number) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r},${g},${bl})`
}

function heatFill(value: number, min: number, max: number) {
  const ratio = max === min ? 0.5 : (value - min) / (max - min)
  const t = Math.max(0, Math.min(1, ratio))
  if (t < 0.33) return mix(COLOR_LOW, COLOR_MID_LOW, t / 0.33)
  if (t < 0.66) return mix(COLOR_MID_LOW, COLOR_MID, (t - 0.33) / 0.33)
  if (t < 0.85) return mix(COLOR_MID, COLOR_HIGH, (t - 0.66) / 0.19)
  return mix(COLOR_HIGH, COLOR_TOP, (t - 0.85) / 0.15)
}

function heatTextColor(value: number, min: number, max: number) {
  const ratio = max === min ? 0.5 : (value - min) / (max - min)
  return ratio >= 0.45 ? COLOR_TEXT_LIGHT : COLOR_TEXT_DARK
}

function formatValue(value: number) {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 100) return value.toFixed(0)
  if (Math.abs(value) >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

function sortFeaturesByExpression(
  features: Feature[],
  values: Map<string, number>
) {
  const scored = features.map((feature) => {
    const fid = nativeFeatureId(feature)
    let max = -Infinity
    let sum = 0
    let n = 0
    for (const [key, value] of values) {
      if (!key.startsWith(`${fid}:`)) continue
      max = Math.max(max, value)
      sum += value
      n += 1
    }
    return {
      feature,
      max: n ? max : -Infinity,
      mean: n ? sum / n : -Infinity,
    }
  })
  scored.sort((a, b) => b.max - a.max || b.mean - a.mean)
  return scored.map((s) => s.feature)
}

function mergeFeatures(existing: Feature[], incoming: Feature[]) {
  const seen = new Set(existing.map((f) => f.id))
  const next = [...existing]
  for (const f of incoming) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    next.push(f)
  }
  return next
}

function matchesBiosample(b: Biosample, q: string) {
  const hay = [
    b.id,
    ontologyLabel(b.sampleOriginType),
    ontologyLabel(b.sampleType),
    ontologyLabel(b.biosampleStatus),
    b.summary,
    b.notes,
    b.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
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

type HoverCell = { row: number; col: number; clientX: number; clientY: number }

type Props = { matrixId: string }

export function MatrixHeatmap({ matrixId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridBodyRef = useRef<HTMLDivElement>(null)

  const [features, setFeatures] = useState<Feature[]>([])
  const [featureTotal, setFeatureTotal] = useState(0)
  const [biosamples, setBiosamples] = useState<Biosample[]>([])
  const [values, setValues] = useState<Map<string, number>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [featureQuery, setFeatureQuery] = useState('')
  const [biosampleQuery, setBiosampleQuery] = useState('')
  const [pinnedFeatureIds, setPinnedFeatureIds] = useState<string[]>([])
  const [rowOffset, setRowOffset] = useState(0)
  const [colOffset, setColOffset] = useState(0)
  const [hover, setHover] = useState<HoverCell | null>(null)
  const [pinned, setPinned] = useState<HoverCell | null>(null)
  const [cellW, setCellW] = useState(MIN_CELL_W)
  const loadingMoreRef = useRef(false)
  const cellWRef = useRef(cellW)
  cellWRef.current = cellW

  const filteredBiosamples = useMemo(() => {
    const q = biosampleQuery.trim().toLowerCase()
    if (!q) return biosamples
    return biosamples.filter((b) => matchesBiosample(b, q))
  }, [biosamples, biosampleQuery])

  const displayFeatures = useMemo(() => {
    if (!pinnedFeatureIds.length) return features
    const byNative = new Map(features.map((f) => [nativeFeatureId(f), f]))
    const byWrapper = new Map(features.map((f) => [f.id, f]))
    const pinnedFeats: Feature[] = []
    const pinnedSet = new Set<string>()
    for (const id of pinnedFeatureIds) {
      const f = byNative.get(id) ?? byWrapper.get(id)
      if (f && !pinnedSet.has(f.id)) {
        pinnedFeats.push(f)
        pinnedSet.add(f.id)
      } else if (!f) {
        pinnedFeats.push({
          id,
          genomicFeature: {
            featureIdentifier: { id },
            aliases: [featureQuery.trim() || id],
          },
        })
        pinnedSet.add(id)
      }
    }
    return [...pinnedFeats, ...features.filter((f) => !pinnedSet.has(f.id))]
  }, [features, pinnedFeatureIds, featureQuery])

  const pageFeatures = useMemo(
    () => displayFeatures.slice(rowOffset, rowOffset + PAGE_ROWS),
    [displayFeatures, rowOffset]
  )
  const pageBiosamples = useMemo(
    () => filteredBiosamples.slice(colOffset, colOffset + PAGE_COLS),
    [filteredBiosamples, colOffset]
  )

  const range = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const f of pageFeatures) {
      const fid = nativeFeatureId(f)
      for (const b of pageBiosamples) {
        const v = values.get(cellKey(fid, b.id))
        if (v === undefined) continue
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (!Number.isFinite(min)) return { min: 0, max: 0 }
    return { min, max }
  }, [values, pageFeatures, pageBiosamples])

  const mergeValues = useCallback(
    (
      rows: { featureId: string; biosampleId: string; value: number }[]
    ) => {
      setValues((prev) => {
        const next = new Map(prev)
        for (const row of rows) {
          next.set(cellKey(row.featureId, row.biosampleId), row.value)
        }
        return next
      })
    },
    []
  )

  const fetchPage = useCallback(
    async (feats: Feature[], samples: Biosample[]) => {
      if (!feats.length || !samples.length) return
      const fSlice = feats.slice(0, MAX_FEATURES_PER_REQUEST)
      const sSlice = samples.slice(0, MAX_SAMPLES_PER_REQUEST)
      const params = new URLSearchParams({
        skip: '0',
        limit: String(EXPR_LIMIT),
        featureIDList: fSlice.map(labelForFeature).join(','),
        biosampleIDList: sSlice.map((b) => b.id).join(','),
      })
      setFetching(true)
      try {
        const data = await listExpressionValues(matrixId, params)
        mergeValues(data.results)
      } finally {
        setFetching(false)
      }
    },
    [matrixId, mergeValues]
  )

  // Initial catalog + high-expression sort seed
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setValues(new Map())
    setPinnedFeatureIds([])
    setRowOffset(0)
    setColOffset(0)
    ;(async () => {
      try {
        const [featPage, bioPage] = await Promise.all([
          listMatrixFeatures(matrixId, 0, INITIAL_FEATURES),
          listMatrixBiosamples(matrixId, 0, BIOSAMPLE_CATALOG_LIMIT),
        ])
        if (cancelled) return
        setFeatureTotal(featPage.total)
        setBiosamples(bioPage.results)

        const seedSamples = bioPage.results.slice(0, PAGE_COLS)
        const map = new Map<string, number>()
        for (
          let fi = 0;
          fi < featPage.results.length;
          fi += MAX_FEATURES_PER_REQUEST
        ) {
          const fChunk = featPage.results.slice(
            fi,
            fi + MAX_FEATURES_PER_REQUEST
          )
          if (!fChunk.length || !seedSamples.length) continue
          const params = new URLSearchParams({
            skip: '0',
            limit: String(EXPR_LIMIT),
            featureIDList: fChunk.map(labelForFeature).join(','),
            biosampleIDList: seedSamples.map((b) => b.id).join(','),
          })
          const data = await listExpressionValues(matrixId, params)
          if (cancelled) return
          for (const row of data.results) {
            map.set(cellKey(row.featureId, row.biosampleId), row.value)
          }
        }
        if (cancelled) return
        setValues(map)
        setFeatures(sortFeaturesByExpression(featPage.results, map))
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load heatmap'
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [matrixId])

  // Fetch visible page
  useEffect(() => {
    if (loading) return
    if (!pageFeatures.length || !pageBiosamples.length) return
    void fetchPage(pageFeatures, pageBiosamples).catch((err) => {
      setError(err instanceof Error ? err.message : 'Expression fetch failed')
    })
  }, [loading, pageFeatures, pageBiosamples, fetchPage])

  // Load more features when paging near the end
  useEffect(() => {
    if (loading || loadingMoreRef.current) return
    if (features.length >= featureTotal) return
    if (rowOffset + PAGE_ROWS < features.length - 5) return
    loadingMoreRef.current = true
    listMatrixFeatures(matrixId, features.length, FEATURE_PAGE)
      .then((page) => {
        setFeatures((prev) => mergeFeatures(prev, page.results))
        setFeatureTotal(page.total)
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : 'Failed to load more features'
        )
      })
      .finally(() => {
        loadingMoreRef.current = false
      })
  }, [loading, rowOffset, features.length, featureTotal, matrixId])

  const cols = Math.max(1, pageBiosamples.length)
  const rows = Math.max(1, pageFeatures.length)
  const canvasW = cols * cellW
  const canvasH = rows * CELL_H

  // Fill available width with equal column cells
  useEffect(() => {
    const el = gridBodyRef.current
    if (!el) return
    const update = () => {
      const n = Math.max(1, pageBiosamples.length)
      const w = el.clientWidth
      setCellW(Math.max(MIN_CELL_W, Math.floor(w / n)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pageBiosamples.length, loading])

  // Draw canvas
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
        ctx.fillStyle =
          value === undefined
            ? COLOR_MISSING
            : heatFill(value, range.min, range.max)
        ctx.fill()

        if (active && active.row === r && active.col === c) {
          ctx.strokeStyle = COLOR_HOVER
          ctx.lineWidth = 2
          roundRect(ctx, x + 1, y + 1, w - 2, h - 2, PILL_RADIUS - 1)
          ctx.stroke()
        }

        const label = value === undefined ? '—' : formatValue(value)
        ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle =
          value === undefined
            ? '#829198'
            : heatTextColor(value, range.min, range.max)
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
    if (
      row < 0 ||
      col < 0 ||
      row >= pageFeatures.length ||
      col >= pageBiosamples.length
    )
      return null
    return { row, col, clientX, clientY }
  }

  const tip = pinned ?? hover
  const tipFeature = tip ? pageFeatures[tip.row] : undefined
  const tipSample = tip ? pageBiosamples[tip.col] : undefined
  const tipValue =
    tipFeature && tipSample
      ? values.get(cellKey(nativeFeatureId(tipFeature), tipSample.id))
      : undefined

  const maxRowOffset = Math.max(0, displayFeatures.length - PAGE_ROWS)
  const maxColOffset = Math.max(0, filteredBiosamples.length - PAGE_COLS)
  const rowFrom = displayFeatures.length ? rowOffset + 1 : 0
  const rowTo = Math.min(rowOffset + PAGE_ROWS, displayFeatures.length)
  const colFrom = filteredBiosamples.length ? colOffset + 1 : 0
  const colTo = Math.min(colOffset + PAGE_COLS, filteredBiosamples.length)

  async function runFeatureSearch(raw: string) {
    const q = raw.trim()
    if (!q) {
      setPinnedFeatureIds([])
      return
    }
    setError('')
    setFetching(true)
    try {
      const samples = filteredBiosamples.slice(0, PAGE_COLS)
      const params = new URLSearchParams({
        skip: '0',
        limit: String(EXPR_LIMIT),
        featureIDList: q
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .join(','),
      })
      if (samples.length) {
        params.set(
          'biosampleIDList',
          samples.map((b) => b.id).join(',')
        )
      }
      const data = await listExpressionValues(matrixId, params)
      mergeValues(data.results)
      const ids = [...new Set(data.results.map((r) => r.featureId))]
      setPinnedFeatureIds(
        ids.length
          ? ids
          : q
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
      )
      setRowOffset(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feature search failed')
    } finally {
      setFetching(false)
    }
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

  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <label className="text-xs font-medium text-[#405761]">
            Feature search
            <div className="mt-1.5 flex gap-2">
              <input
                value={featureQuery}
                onChange={(e) => setFeatureQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runFeatureSearch(featureQuery)
                }}
                placeholder="TP53, BRCA1, ENSG…"
                className="w-52 rounded-md border border-[#cbd9de] bg-white px-3 py-2 font-mono text-sm outline-none ring-[#0c7c86] focus:ring-2"
              />
              <button
                type="button"
                onClick={() => void runFeatureSearch(featureQuery)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0c7c86] px-3 py-2 text-sm font-semibold text-white hover:bg-[#095f67]"
              >
                <Search className="size-4" />
                Go
              </button>
            </div>
          </label>
          <label className="text-xs font-medium text-[#405761]">
            Biosample search
            <input
              value={biosampleQuery}
              onChange={(e) => {
                setBiosampleQuery(e.target.value)
                setColOffset(0)
              }}
              placeholder="ID, ontology, description…"
              className="mt-1.5 w-64 rounded-md border border-[#cbd9de] bg-white px-3 py-2 text-sm outline-none ring-[#0c7c86] focus:ring-2"
            />
          </label>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div
            className="h-2.5 w-40 rounded-sm"
            style={{
              background: `linear-gradient(90deg, ${COLOR_LOW}, ${COLOR_MID_LOW}, ${COLOR_MID}, ${COLOR_HIGH}, ${COLOR_TOP})`,
            }}
          />
          <div className="flex w-40 justify-between text-[10px] uppercase tracking-wider text-[#829198]">
            <span>low</span>
            <span>high</span>
          </div>
          <p className="text-[11px] text-[#829198]">
            genes {rowFrom}–{rowTo}
            {featureTotal ? ` / ${featureTotal.toLocaleString()}` : ''}
            {' · '}
            samples {colFrom}–{colTo}
            {filteredBiosamples.length
              ? ` / ${filteredBiosamples.length.toLocaleString()}`
              : ''}
            {fetching && ' · updating…'}
          </p>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-[#fff4f1] px-3 py-2 text-sm text-[#a34c3b]">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[#71818a]">Loading heatmap…</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-[#dce7ea] bg-white">
          <div
            className="grid w-full"
            style={{
              gridTemplateColumns: `${ROW_LABEL_W}px ${AXIS_BTN}px minmax(0, 1fr) ${AXIS_BTN}px`,
              gridTemplateRows: `${COL_HEADER_H}px auto auto`,
            }}
          >
            {/* Corner: feature axis label + gene up */}
            <div className="relative z-0 flex flex-col items-center justify-between border-b border-r border-[#dce7ea] bg-[#f7faf9] px-2 py-2">
              <p className="w-full text-[10px] font-semibold uppercase tracking-wider text-[#829198]">
                Feature / id
              </p>
              <ArrowBtn
                label="Previous genes"
                disabled={rowOffset <= 0}
                onClick={() =>
                  setRowOffset((o) => Math.max(0, o - PAGE_ROWS))
                }
              >
                <ChevronUp className="size-4" />
              </ArrowBtn>
            </div>

            {/* Biosample prev — on the column header row */}
            <div className="relative z-0 flex items-center justify-center border-b border-[#dce7ea] bg-[#f7faf9]">
              <ArrowBtn
                label="Previous biosamples"
                disabled={colOffset <= 0}
                onClick={() =>
                  setColOffset((o) => Math.max(0, o - PAGE_COLS))
                }
              >
                <ChevronLeft className="size-4" />
              </ArrowBtn>
            </div>

            {/* Biosample headers */}
            <div className="relative z-0 flex border-b border-[#dce7ea] bg-[#f7faf9]">
              {pageBiosamples.map((sample) => {
                const primary = biosamplePrimary(sample)
                const secondary = biosampleSecondary(sample)
                return (
                  <div
                    key={sample.id}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end overflow-hidden px-1 pb-2 text-center"
                    title={[primary, secondary, sample.id]
                      .filter(Boolean)
                      .join('\n')}
                  >
                    <p className="w-full truncate text-[11px] font-semibold uppercase tracking-wide text-[#405761]">
                      {primary}
                    </p>
                    {secondary && (
                      <p className="w-full truncate text-[9px] text-[#829198]">
                        {secondary}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Biosample next */}
            <div className="relative z-0 flex items-center justify-center border-b border-l border-[#dce7ea] bg-[#f7faf9]">
              <ArrowBtn
                label="Next biosamples"
                disabled={colOffset >= maxColOffset}
                onClick={() =>
                  setColOffset((o) => Math.min(maxColOffset, o + PAGE_COLS))
                }
              >
                <ChevronRight className="size-4" />
              </ArrowBtn>
            </div>

            {/* Gene labels */}
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

            {/* Canvas — fills remaining width */}
            <div ref={gridBodyRef} className="relative z-0 min-w-0 w-full">
              <canvas
                ref={canvasRef}
                className="block cursor-pointer"
                style={{ width: canvasW, height: canvasH }}
                onMouseMove={(e) => {
                  if (pinned) return
                  setHover(hitTest(e.clientX, e.clientY))
                }}
                onMouseLeave={() => {
                  if (!pinned) setHover(null)
                }}
                onClick={(e) => {
                  const hit = hitTest(e.clientX, e.clientY)
                  if (
                    pinned &&
                    hit &&
                    pinned.row === hit.row &&
                    pinned.col === hit.col
                  ) {
                    setPinned(null)
                    return
                  }
                  setPinned(hit)
                  setHover(hit)
                }}
              />
            </div>

            <div className="border-l border-[#edf2f3] bg-white" />

            {/* Gene down — under the gene name column */}
            <div className="relative z-0 flex items-center justify-center border-t border-r border-[#edf2f3] bg-[#f7faf9] py-2">
              <ArrowBtn
                label="Next genes"
                disabled={rowOffset >= maxRowOffset}
                onClick={() =>
                  setRowOffset((o) => Math.min(maxRowOffset, o + PAGE_ROWS))
                }
              >
                <ChevronDown className="size-4" />
              </ArrowBtn>
            </div>
            <div className="border-t border-[#edf2f3] bg-[#f7faf9]" />
            <div className="border-t border-[#edf2f3] bg-[#f7faf9]" />
            <div className="border-t border-[#edf2f3] bg-[#f7faf9]" />
          </div>

          {/* Fixed tooltip escapes label stacking */}
          {tip && tipFeature && tipSample && (
            <div
              className="pointer-events-none fixed z-[200] max-w-xs rounded-md border border-[#dce7ea] bg-white px-3 py-2 text-xs shadow-md"
              style={{
                left: tip.clientX,
                top: tip.clientY - 12,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <p className="font-semibold text-[#20353d]">
                {labelForFeature(tipFeature)}
              </p>
              <p className="mt-0.5 text-[#71818a]">
                {biosamplePrimary(tipSample)}
                {biosampleSecondary(tipSample)
                  ? ` · ${biosampleSecondary(tipSample)}`
                  : ''}
              </p>
              <p className="mt-1 font-mono text-[#0c7c86]">
                {tipValue === undefined ? '—' : formatValue(tipValue)}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
