import {
  featurePresentInTissue,
  probeExploreTissueBands,
  resetExploreTissueBandCaches,
  tissueBandPairKey,
  tissueCellRequest,
} from '@/lib/explore-tissue-bands'
import type { Feature } from '@/lib/beacon/types'
import type { TissueColumn } from '@/lib/tissue-levels'

const feat = (id: string, matrixIds: string[], resource = 'gencode'): Feature => ({
  id: `feature-${id}`,
  featureIdentifier: { id, resource },
  matrixIds,
})

const features: Feature[] = [
  feat('TOP', ['M1']),
  feat('PRESENT', ['M1']),
  feat('NONE', ['M2']),
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

/** blood and liver are in M1 only → NONE (M2) is absent. */
const ontologyIndex = new Map<string, string[]>([
  ['uberon:0000178', ['M1']],
  ['uberon:0002107', ['M1']],
])

const originalFetch = globalThis.fetch

type Asked = {
  granularity: string
  symbol: string
  resource: string
  tissue: string
  method: string
}

function readAsked(init?: RequestInit): Asked {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  const filters: { id: string; operator?: string; value?: string }[] =
    body?.query?.filters ?? []
  const symbol = filters.find((f) => f.id === 'symbol')
  const resource = filters.find((f) => f.id === 'feature.resource')
  const tissue = filters.find((f) => f.id.startsWith('tissue.percentile:'))
  console.assert(tissue?.operator === '>=' && tissue?.value === '99')
  return {
    granularity: body?.query?.requestedGranularity,
    symbol: symbol?.value ?? '',
    resource: resource?.value ?? '',
    tissue: tissue?.id.slice('tissue.percentile:'.length) ?? '',
    method: (init?.method ?? 'GET').toUpperCase(),
  }
}

function booleanResponse(exists: boolean): Response {
  return new Response(
    JSON.stringify({ responseSummary: { exists } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/** TOP is in the top 1% of every tissue; the rest are not. */
function answer(asked: Asked): Response {
  return booleanResponse(asked.symbol === 'TOP')
}

async function run() {
  resetExploreTissueBandCaches()
  const asked: Asked[] = []
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const a = readAsked(init)
    asked.push(a)
    return answer(a)
  }) as typeof fetch

  try {
    console.assert(featurePresentInTissue(features[0], blood.ontologyId, ontologyIndex))
    console.assert(!featurePresentInTissue(features[2], blood.ontologyId, ontologyIndex))

    // The request users see is the request that is sent.
    const shown = tissueCellRequest(features[0], blood.ontologyId)
    console.assert(shown.method === 'POST' && shown.path === '/features')
    console.assert(shown.body?.query.requestedGranularity === 'boolean')

    const progress: number[] = []
    const first = await probeExploreTissueBands({
      features,
      columns: [blood],
      ontologyMatrixIndex: ontologyIndex,
      onProgress: (d) => progress.push(d.probedPairs.size),
    })
    console.assert(first.bands.get('feature-TOP')?.[blood.ontologyId] === 99)
    console.assert(first.bands.get('feature-PRESENT')?.[blood.ontologyId] === 0)
    console.assert(
      first.bands.get('feature-NONE')?.[blood.ontologyId] == null,
      'absent stays none (missing key)'
    )
    for (const f of features) {
      console.assert(
        first.probedPairs.has(tissueBandPairKey(f.id, blood.ontologyId)),
        `probed ${f.id}`
      )
    }
    console.assert(asked.length === 2, 'absent cell is never asked')
    console.assert(asked.every((a) => a.granularity === 'boolean' && a.method === 'POST'))
    console.assert(asked.every((a) => a.resource === 'gencode'))
    console.assert(asked.every((a) => a.tissue === blood.ontologyId))
    console.assert(
      asked.map((a) => a.symbol).sort().join() === 'PRESENT,TOP',
      'symbol = feature accession'
    )
    console.assert(progress[0] === 1, 'absent cell delivered before any request')

    // Cached cells are not asked again; only the new gene is.
    asked.length = 0
    const second = await probeExploreTissueBands({
      features: [...features, feat('NEW', ['M1'])],
      columns: [blood],
      skipPairs: first.probedPairs,
      ontologyMatrixIndex: ontologyIndex,
    })
    console.assert(asked.length === 1 && asked[0].symbol === 'NEW')
    console.assert(second.bands.get('feature-NEW')?.[blood.ontologyId] === 0)
    asked.length = 0
    await probeExploreTissueBands({
      features: [...features, feat('NEW', ['M1'])],
      columns: [blood],
      ontologyMatrixIndex: ontologyIndex,
    })
    console.assert(asked.length === 0, 'answers are cached')

    // A failing request leaves that cell unprobed; other cells stay painted.
    resetExploreTissueBandCaches()
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const a = readAsked(init)
      if (a.tissue === liver.ontologyId) return new Response('no', { status: 500 })
      return answer(a)
    }) as typeof fetch
    const partial = await probeExploreTissueBands({
      features,
      columns: [blood, liver],
      ontologyMatrixIndex: ontologyIndex,
    })
    console.assert(partial.bands.get('feature-TOP')?.[blood.ontologyId] === 99)
    console.assert(
      !partial.probedPairs.has(tissueBandPairKey('feature-TOP', liver.ontologyId)),
      'failed cell is not marked probed'
    )

    // Seeded tissue: every pending gene is assumed present (and is asked).
    resetExploreTissueBandCaches()
    asked.length = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const a = readAsked(init)
      asked.push(a)
      return answer(a)
    }) as typeof fetch
    const assumed = await probeExploreTissueBands({
      features,
      columns: [blood],
      assumePresentOntologyIds: [blood.ontologyId],
      ontologyMatrixIndex: ontologyIndex,
    })
    console.assert(asked.length === 3)
    console.assert(assumed.bands.get('feature-NONE')?.[blood.ontologyId] === 0)

    // The proxy rate-limits bursts: a 429 is retried, not surfaced.
    resetExploreTissueBandCaches()
    let calls = 0
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const a = readAsked(init)
      calls += 1
      if (calls === 1) return new Response('{"error":{"errorMessage":"Too many requests"}}', { status: 429 })
      return answer(a)
    }) as typeof fetch
    const limited = await probeExploreTissueBands({
      features: [features[0]],
      columns: [blood],
      ontologyMatrixIndex: ontologyIndex,
    })
    console.assert(calls === 2 && limited.bands.get('feature-TOP')?.[blood.ontologyId] === 99)

    console.log('explore-tissue-bands.test.ts: ok')
  } finally {
    globalThis.fetch = originalFetch
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
