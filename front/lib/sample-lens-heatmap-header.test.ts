import type { Biosample } from '@/lib/beacon/types'
import { biosampleHeatmapColumnHeader } from './sample-lens'

const peerA: Biosample = {
  id: 'biosample-a',
  sampleOriginType: { id: 'OBI:0000671', label: 'cell specimen' },
  sampleOriginDetail: { id: 'UBERON:0002107', label: 'liver' },
}

const peerB: Biosample = {
  id: 'biosample-b',
  sampleOriginType: { id: 'OBI:0000671', label: 'cell specimen' },
  sampleOriginDetail: { id: 'UBERON:0000955', label: 'brain' },
}

const peers = [peerA, peerB]

const headerA = biosampleHeatmapColumnHeader(peerA, peers)
const headerB = biosampleHeatmapColumnHeader(peerB, peers)

console.assert(headerA.title === 'liver', `expected liver, got ${headerA.title}`)
console.assert(headerB.title === 'brain', `expected brain, got ${headerB.title}`)
console.assert(headerA.title !== headerB.title)

const dupOrigin: Biosample[] = [
  {
    id: 's1',
    sampleOriginType: { label: 'tissue sample' },
    sampleOriginDetail: { label: 'liver' },
    description: 'Donor 1 replicate',
  },
  {
    id: 's2',
    sampleOriginType: { label: 'tissue sample' },
    sampleOriginDetail: { label: 'liver' },
    description: 'Donor 2 replicate',
  },
]

const h1 = biosampleHeatmapColumnHeader(dupOrigin[0], dupOrigin)
const h2 = biosampleHeatmapColumnHeader(dupOrigin[1], dupOrigin)
console.assert(h1.title !== h2.title || h1.subtitle !== h2.subtitle)
console.assert(h1.title !== h1.subtitle)
console.assert(h2.title !== h2.subtitle)

console.log('sample-lens-heatmap-header.test.ts: ok')
