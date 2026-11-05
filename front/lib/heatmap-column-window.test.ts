import {
  HEATMAP_COL_FALLBACK_PX,
  heatmapColumnWindow,
} from '@/lib/heatmap-table'

const few = heatmapColumnWindow({
  columnCount: 10,
  scrollLeft: 0,
  viewportW: 400,
  colWidth: HEATMAP_COL_FALLBACK_PX,
  few: true,
})
console.assert(few.start === 0 && few.end === 10)
console.assert(few.padLeft === 0 && few.padRight === 0)

const mid = heatmapColumnWindow({
  columnCount: 40,
  scrollLeft: 720,
  viewportW: 360,
  colWidth: 72,
  few: false,
  overscan: 4,
})
// floor(720/72)-4 = 10-4 = 6; ceil((720+360)/72)+4 = 15+4 = 19
console.assert(mid.start === 6, `start=${mid.start}`)
console.assert(mid.end === 19, `end=${mid.end}`)
console.assert(mid.padLeft === 6 * 72)
console.assert(mid.padRight === (40 - 19) * 72)

console.log('heatmap-column-window.test.ts: ok')
