import {
  probeExploreTissueBands,
  tissueBandPairKey,
} from '@/lib/explore-tissue-bands'
import type { Feature } from '@/lib/beacon/types'
import type { TissueColumn } from '@/lib/tissue-levels'

const features: Feature[] = [
  { id: 'f-top' },
  { id: 'f-present' },
  { id: 'f-none' },
]

const blood: TissueColumn = {
  ontologyId: 'UBERON:0000178',
  label: 'blood',
  nBiosamples: null,
}

const liver: TissueColumn = {
  ontologyId: 'UBERON:0002107',
  label: 'liver',
  nBiosamples: null,
}

const originalFetch = globalThis.fetch

function hitsFor(filterId: string, idList: string[]): string[] {
  if (filterId.startsWith('tissuePresent:')) {
    return idList.filter((id) => id === 'f-top' || id === 'f-present')
  }
  if (filterId.startsWith('tissueTop:')) {
    return idList.filter((id) => id === 'f-top')
  }
  return []
}

function jsonResponse(hits: string[]): Response {
  return new Response(
    JSON.stringify({
      response: {
        resultSets: [
          {
            results: hits.map((id) => ({ id })),
          },
        ],
      },
      responseSummary: { numTotalResults: hits.length },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

function readRequest(init?: RequestInit): { filterId: string; idList: string[] } {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  const filters = body?.query?.filters ?? []
  const filterId = String(filters[0]?.id ?? '')
  const idList = String(body?.query?.requestParameters?.featureIDList ?? '')
    .split(',')
    .filter(Boolean)
  return { filterId, idList }
}

async function run() {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { filterId, idList } = readRequest(init)
    return jsonResponse(hitsFor(filterId, idList))
  }) as typeof fetch

  try {
    const map = await probeExploreTissueBands({
      features,
      columns: [blood],
    })
    console.assert(map.bands.get('f-top')?.[blood.ontologyId] === 99)
    console.assert(map.bands.get('f-present')?.[blood.ontologyId] === 0)
    console.assert(
      map.bands.get('f-none')?.[blood.ontologyId] == null,
      'absent stays none (missing key)'
    )
    for (const feature of features) {
      console.assert(
        map.probedPairs.has(tissueBandPairKey(feature.id, blood.ontologyId)),
        `probed ${feature.id}`
      )
    }

    const resent: string[][] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { filterId, idList } = readRequest(init)
      resent.push(idList)
      return jsonResponse(hitsFor(filterId, idList))
    }) as typeof fetch

    const second = await probeExploreTissueBands({
      features: [...features, { id: 'f-new' }],
      columns: [blood],
      skipPairs: map.probedPairs,
    })
    console.assert(resent.length > 0, 'new feature is probed')
    for (const idList of resent) {
      console.assert(
        idList.length === 1 && idList[0] === 'f-new',
        `resent probed ids: ${idList.join(',')}`
      )
    }
    console.assert(
      second.probedPairs.has(tissueBandPairKey('f-new', blood.ontologyId))
    )
    console.assert(second.bands.get('f-new')?.[blood.ontologyId] == null)

    const failedLists: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { filterId, idList } = readRequest(init)
      if (filterId.includes(liver.ontologyId)) {
        failedLists.push(filterId)
        return new Response('no', { status: 500 })
      }
      return jsonResponse(hitsFor(filterId, idList))
    }) as typeof fetch

    const partial = await probeExploreTissueBands({
      features,
      columns: [blood, liver],
    })
    console.assert(partial.bands.get('f-top')?.[blood.ontologyId] === 99)
    console.assert(partial.bands.get('f-present')?.[blood.ontologyId] === 0)
    console.assert(
      partial.probedPairs.has(tissueBandPairKey('f-top', blood.ontologyId))
    )
    console.assert(
      !partial.probedPairs.has(tissueBandPairKey('f-top', liver.ontologyId)),
      'failed column is not marked probed'
    )
    console.assert(failedLists.length > 0)
    console.assert(partial.bands.get('f-top')?.[liver.ontologyId] == null)

    const assumeFilters: string[] = []
    const assumeIdLists: string[][] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { filterId, idList } = readRequest(init)
      assumeFilters.push(filterId)
      assumeIdLists.push(idList)
      return jsonResponse(hitsFor(filterId, idList))
    }) as typeof fetch

    const assumed = await probeExploreTissueBands({
      features,
      columns: [blood],
      assumePresentOntologyIds: [blood.ontologyId],
    })
    console.assert(
      assumeFilters.every((id) => id.startsWith('tissueTop:')),
      'assume-present skips tissuePresent'
    )
    console.assert(assumeFilters.length === 1)
    console.assert(
      assumeIdLists[0]?.length === features.length,
      'tissueTop gets every pending id'
    )
    console.assert(assumed.bands.get('f-top')?.[blood.ontologyId] === 99)
    console.assert(assumed.bands.get('f-present')?.[blood.ontologyId] === 0)
    console.assert(assumed.bands.get('f-none')?.[blood.ontologyId] === 0)

    console.log('explore-tissue-bands.test.ts: ok')
  } finally {
    globalThis.fetch = originalFetch
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
