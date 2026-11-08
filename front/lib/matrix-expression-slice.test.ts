import assert from 'node:assert/strict'
import type { ExpressionValue } from '@/lib/beacon/types'
import { cellKey } from '@/lib/heatmap-expression'
import {
  deriveSliceHeatmapAxes,
  mergeFeatureRecordsByNativeId,
  mergeRecordsById,
  sliceAxesCanExtend,
  sliceAxesGrew,
  stubBiosamplesFromIds,
  stubFeaturesFromIds} from '@/lib/matrix-expression-slice'

function cell(
  featureId: string,
  biosampleId: string,
  value: number
): ExpressionValue {
  return {
    id: `${featureId}:${biosampleId}`,
    matrixId: 'M',
    featureId,
    biosampleId,
    value}
}

const ranked = [
  cell('F1', 'B1', 90),
  cell('F1', 'B2', 80),
  cell('F2', 'B1', 70),
  cell('F3', 'B3', 60),
  cell('F2', 'B4', 50),
]

const axes = deriveSliceHeatmapAxes(ranked, 2, 3)
assert.deepEqual(axes.featureIds, ['F1', 'F2'])
assert.deepEqual(axes.biosampleIds, ['B1', 'B2', 'B4'])
assert.equal(axes.values.get(cellKey('F1', 'B1')), 90)
assert.equal(axes.values.get(cellKey('F2', 'B4')), 50)
assert.equal(axes.values.has(cellKey('F3', 'B3')), false)

const cappedBios = deriveSliceHeatmapAxes(ranked, 12, 2)
assert.deepEqual(cappedBios.biosampleIds, ['B1', 'B2'])

const empty = deriveSliceHeatmapAxes([])
assert.deepEqual(empty.featureIds, [])
assert.deepEqual(empty.biosampleIds, [])
assert.equal(empty.values.size, 0)

assert.equal(sliceAxesCanExtend(12, 24), false)
assert.equal(sliceAxesCanExtend(12, 23), true)
assert.equal(sliceAxesCanExtend(11, 24), true)

const beforeGrow = deriveSliceHeatmapAxes([cell('F1', 'B1', 1)], 12, 24)
const afterGrow = deriveSliceHeatmapAxes(
  [cell('F1', 'B1', 1), cell('F2', 'B1', 2)],
  12,
  24
)
assert.equal(sliceAxesGrew(beforeGrow, afterGrow), true)
assert.equal(sliceAxesGrew(beforeGrow, beforeGrow), false)

const features = stubFeaturesFromIds(['F1', 'F2'])
assert.equal(features[0].featureIdentifier?.id, 'F1')
const biosamples = stubBiosamplesFromIds(['B1'])
assert.equal(biosamples[0].id, 'B1')

const merged = mergeRecordsById(features, [
  {
    id: 'F2',
    featureIdentifier: { id: 'ENSG2' },
      aliases: ['GENE2']},
])
assert.equal(merged[0].id, 'F1')
assert.equal(merged[1].aliases?.[0], 'GENE2')

// Expression stubs use native accession as id; Beacon rows use wrapper id.
const nativeMerged = mergeFeatureRecordsByNativeId(stubFeaturesFromIds(['ENSG1', 'ENSG2']), [
  {
    id: 'wrapper-2',
    featureIdentifier: { id: 'ENSG2' },
      aliases: ['TP53'],
    matrixIds: ['M']},
])
assert.equal(nativeMerged[0].id, 'ENSG1')
assert.equal(nativeMerged[1].id, 'wrapper-2')
assert.equal(nativeMerged[1].aliases?.[0], 'TP53')

console.log('matrix-expression-slice.test.ts: ok')
