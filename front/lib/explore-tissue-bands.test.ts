import {
  featurePresentInTissue,
  probeExploreTissueBands,
  resetExploreTissueBandCaches,
  tissueBandPairKey,
} from '@/lib/explore-tissue-bands'
import type { Feature } from '@/lib/beacon/types'
import type { TissueColumn } from '@/lib/tissue-levels'

const features: Feature[] = [
  { id: 'f-top', matrixIds: ['M1'] },
  { id: 'f-present', matrixIds: ['M1'] },
  { id: 'f-none', matrixIds: ['M2'] },
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

/** blood is in M1 only → f-none (M2) is absent. */
const ontologyIndex = new Map<string, string[]>([
  ['uberon:0000178', ['M1']],
  ['uberon:0002107', ['M1']],
])

const originalFetch = globalThis.fetch

function hitsFor(filterId: string, idList: string[]): string[] {
  if (filterId.startsWith('tissueTop:')) {
    return idList.filter((id) => id === 'f-top')
  }
  // tissuePresent should no longer be requested.
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

function readRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): { filterId: string; idList: string[]; method: string } {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'POST') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    const filters = body?.query?.filters ?? []
    const filterId = String(filters[0]?.id ?? '')
    const idList = String(body?.query?.requestParameters?.featureIDList ?? '')
      .split(',')
      .filter(Boolean)
    return { filterId, idList, method }
  }
  const url = new URL(String(input), 'http://local.test')
  const filterId = (url.searchParams.get('filters') ?? '').split(',')[0] ?? ''
  const idList = (url.searchParams.get('featureIDList') ?? '')
    .split(',')
    .filter(Boolean)
  return { filterId, idList, method }
}

async function run() {
  resetExploreTissueBandCaches()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { filterId, idList } = readRequest(input, init)
    console.assert(
      !filterId.startsWith('tissuePresent:'),
      'local present must not probe tissuePresent'
    )
    return jsonResponse(hitsFor(filterId, idList))
  }) as typeof fetch

  try {
    console.assert(
      featurePresentInTissue(features[0], blood.ontologyId, ontologyIndex)
    )
    console.assert(
      !featurePresentInTissue(features[2], blood.ontologyId, ontologyIndex)
    )

    const map = await probeExploreTissueBands({
      features,
      columns: [blood],
      ontologyMatrixIndex: ontologyIndex,
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
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const { filterId, idList } = readRequest(input, init)
      resent.push(idList)
      return jsonResponse(hitsFor(filterId, idList))
    }) as typeof fetch

    const second = await probeExploreTissueBands({
      features: [...features, { id: 'f-new', matrixIds: ['M1'] }],
      columns: [blood],
      skipPairs: map.probedPairs,
      ontologyMatrixIndex: ontologyIndex,
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
    // Locally present in M1 but not tissueTop → band 0 (<99).
    console.assert(second.bands.get('f-new')?.[blood.ontologyId] === 0)

    const failedLists: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const { filterId, idList } = readRequest(input, init)
      if (filterId.includes(liver.ontologyId)) {
        failedLists.push(filterId)
        return new Response('no', { status: 500 })
      }
      return jsonResponse(hitsFor(filterId, idList))
    }) as typeof fetch
    resetExploreTissueBandCaches()

    const partial = await probeExploreTissueBands({
      features,
      columns: [blood, liver],
      ontologyMatrixIndex: ontologyIndex,
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
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const { filterId, idList } = readRequest(input, init)
      assumeFilters.push(filterId)
      assumeIdLists.push(idList)
      return jsonResponse(hitsFor(filterId, idList))
    }) as typeof fetch
    resetExploreTissueBandCaches()

    const assumed = await probeExploreTissueBands({
      features,
      columns: [blood],
      assumePresentOntologyIds: [blood.ontologyId],
      ontologyMatrixIndex: ontologyIndex,
    })
    console.assert(
      assumeFilters.every((id) => id.startsWith('tissueTop:')),
      'assume-present only probes tissueTop'
    )
    console.assert(assumeFilters.length === 1)
    console.assert(
      assumeIdLists[0]?.length === features.length,
      'tissueTop gets every pending id under assume-present'
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
