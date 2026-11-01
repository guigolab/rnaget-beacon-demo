import { buildLensPreviewNote } from './lens-preview-note'

const okProbe = { loading: false, exists: true as const, total: 100, error: '' }

console.assert(
  buildLensPreviewNote({
    probe: okProbe,
    previewLimit: 20,
    previewCount: 20,
    previewHint: 'GET or POST /biosamples',
  }) === 'Showing 20 of 100 · GET or POST /biosamples'
)

console.assert(
  buildLensPreviewNote({
    probe: { ...okProbe, total: 5 },
    previewLimit: 20,
    previewCount: 5,
    previewHint: 'GET or POST /biosamples',
  }) === 'GET or POST /biosamples'
)

console.assert(
  buildLensPreviewNote({
    probe: okProbe,
    previewLimit: 20,
    previewCount: 20,
    previewWhenShowing: 'Matrix medians',
    previewTruncatedSuffix: 'expression_summary',
  }) === 'Showing 20 of 100 · expression_summary'
)

console.assert(
  buildLensPreviewNote({
    probe: okProbe,
    previewLimit: 20,
    previewCount: 20,
  }) === 'Showing first 20 at record granularity (limit 20)'
)

console.assert(
  buildLensPreviewNote({
    probe: { ...okProbe, total: 5 },
    previewLimit: 20,
    previewCount: 5,
  }) === 'Record granularity'
)

console.log('lens-preview-note.test.ts ok')
