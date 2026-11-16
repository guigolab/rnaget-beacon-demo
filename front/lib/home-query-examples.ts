import {
  FEATURE_BIOTYPE_FAMILY_ID,
  FALLBACK_MATRIX_IDS,
  isFeatureLensFilter,
  matrixSourceFilter,
  scopeOf,
  symbolFilter,
  type FilteringTerm,
  type UiFilter,
} from '@/lib/beacon'
import type { Granularity } from '@/lib/beacon'
import type { QueryOptions } from '@/lib/beacon/query'
import {
  exploreLensSearchParams,
  tissuePresentFilter,
  tissueTopFilter,
} from '@/lib/explore-lens'
import { geneLensQueryExamples } from '@/lib/gene-lens'
import { matrixLensQueryExamples } from '@/lib/matrix-lens'
import { sampleLensQueryExamples } from '@/lib/sample-lens'

export type HomeExampleTab =
  | 'matrix'
  | 'feature'
  | 'biosample'
  | 'expressionValue'
  | 'explore'

export type HomeExampleRequest = {
  path: string
  opts: QueryOptions
}

export type HomeQueryExample = {
  id: string
  tab: HomeExampleTab
  title: string
  blurb: string
  /** Runnable Beacon request, when the example hits the API. */
  request?: HomeExampleRequest
  /** Deep link into the app (Explore / Matrices). */
  href?: string
  /** Extra curl lines for Explore (synthetic Beacon calls under the hood). */
  underlying?: Array<{ label: string; request: HomeExampleRequest }>
}

/** Granularity an example is requested at (Beacon `requestedGranularity`). */
export function exampleGranularity(example: HomeQueryExample): Granularity {
  return example.request?.opts.granularity ?? 'record'
}

export const HOME_EXAMPLE_TABS: Array<{ id: HomeExampleTab; label: string }> = [
  { id: 'matrix', label: 'Matrices' },
  { id: 'feature', label: 'Genomic features' },
  { id: 'biosample', label: 'Biosamples' },
  { id: 'expressionValue', label: 'Expression values' },
  { id: 'explore', label: 'Explore' },
]

function recordOpts(filters?: UiFilter[], extra?: Partial<QueryOptions>): QueryOptions {
  return {
    skip: 0,
    limit: 3,
    granularity: 'record',
    ...(filters?.length ? { filters } : {}),
    ...extra,
  }
}

function preferredMatrixId(matrixIds: string[]): string {
  const preferred =
    matrixIds.find((id) => /gtex/i.test(id) && /liver/i.test(id)) ??
    matrixIds.find((id) => /gtex/i.test(id)) ??
    matrixIds[0] ??
    FALLBACK_MATRIX_IDS[0]
  return preferred
}

function exploreHref(filters: UiFilter[]): string {
  const params = exploreLensSearchParams({
    featureFilters: filters.filter((f) => isFeatureLensFilter(f)),
    biosampleFilters: filters.filter((f) => scopeOf(f) === 'biosample'),
  })
  const qs = params.toString()
  return qs ? `/explore/?${qs}` : '/explore/'
}

/**
 * Build demo query examples. `matrixIds` should come from a live
 * `listMatrices` call when available; falls back to package constants.
 *
 * Each title is a real question a user would ask; the request answers it at the
 * Beacon granularity that fits (boolean → yes/no, count → how many, record → which).
 */
export function buildHomeQueryExamples(opts: {
  terms?: FilteringTerm[]
  matrixIds?: string[]
}): HomeQueryExample[] {
  const terms = opts.terms ?? []
  const matrixIds = opts.matrixIds ?? []
  const matrixId = preferredMatrixId(matrixIds)
  const lungMatrixId = matrixIds.find((id) => /gtex/i.test(id) && /lung/i.test(id))
  const matrixPath = `/matrices/${encodeURIComponent(matrixId)}`
  const matrixHref = `/matrices/?matrix=${encodeURIComponent(matrixId)}`

  const geneExamples = geneLensQueryExamples(terms)
  const sampleExamples = sampleLensQueryExamples(terms)
  const matrixExamples = matrixLensQueryExamples(terms)

  const tp53 =
    geneExamples.find((e) => e.label === 'TP53')?.filter ?? symbolFilter('TP53')
  const alb = symbolFilter('ALB')
  const proteinCoding =
    geneExamples.find((e) => /protein-coding/i.test(e.label))?.filter ??
    ({
      kind: 'alphanumeric',
      id: FEATURE_BIOTYPE_FAMILY_ID,
      value: 'protein_coding',
      label: 'Gene type = protein_coding',
    } satisfies UiFilter)

  const liver =
    sampleExamples.find((e) => /liver/i.test(e.label))?.filter ??
    ({
      kind: 'ontology',
      id: 'UBERON:0002107',
      label: 'liver',
    } satisfies UiFilter)
  const brainExample = sampleExamples.find((e) => /brain/i.test(e.label))?.filter
  const brain: Extract<UiFilter, { kind: 'ontology' }> =
    brainExample?.kind === 'ontology'
      ? brainExample
      : { kind: 'ontology', id: 'UBERON:0000955', label: 'brain' }

  const tpm =
    matrixExamples.find((e) => e.label === 'TPM')?.filter ??
    ({
      kind: 'alphanumeric',
      id: 'matrix.unit',
      value: 'TPM',
      label: 'unit = TPM',
    } satisfies UiFilter)
  const fpkm = {
    kind: 'alphanumeric',
    id: 'matrix.unit',
    value: 'FPKM',
    label: 'unit = FPKM',
  } satisfies UiFilter
  const gtex =
    matrixExamples.find((e) => /gtex/i.test(e.label))?.filter ??
    matrixSourceFilter('gtex', 'source = GTEx')
  const assay =
    matrixExamples.find((e) => /bulk rna/i.test(e.label))?.filter ??
    ({
      kind: 'ontology',
      id: 'OBI:0003090',
      label: 'bulk RNA-seq assay',
    } satisfies UiFilter)

  const LIVER_ID = 'UBERON:0002107'
  // GTEx matrices are keyed by Ensembl gene version; ALB = ENSG00000163631.16.
  const ALB_ENSEMBL = 'ENSG00000163631.16'

  const examples: HomeQueryExample[] = [
    // ── Matrices ────────────────────────────────────────────────────────────
    {
      id: 'matrix-gtex-tpm',
      tab: 'matrix',
      title: 'Which GTEx matrices are quantified in TPM?',
      blurb:
        'Two alphanumeric filters on the matrix collection — matrix.source = gtex AND matrix.unit = TPM. Filters are ANDed and sent as POST.',
      request: { path: '/matrices', opts: recordOpts([gtex, tpm]) },
      href: '/matrices/',
    },
    {
      id: 'matrix-fpkm-exists',
      tab: 'matrix',
      title: 'Is any matrix quantified in FPKM?',
      blurb:
        'A yes/no question needs no records: boolean granularity returns only responseSummary.exists.',
      request: {
        path: '/matrices',
        opts: recordOpts([fpkm], { granularity: 'boolean' }),
      },
      href: '/matrices/',
    },
    {
      id: 'matrix-assay-count',
      tab: 'matrix',
      title: 'How many bulk RNA-seq matrices are there?',
      blurb:
        'Ontology filter OBI:0003090 (bulk RNA-seq assay). Count granularity returns numTotalResults without any records.',
      request: {
        path: '/matrices',
        opts: recordOpts([assay], { granularity: 'count' }),
      },
      href: '/matrices/',
    },
    {
      id: 'matrix-single',
      tab: 'matrix',
      title: `Describe one matrix · ${matrixId}`,
      blurb: 'Single-entry path /matrices/{id}: units, assembly, annotation and dimensions.',
      request: {
        path: matrixPath,
        opts: recordOpts(undefined, { limit: 1 }),
      },
      href: matrixHref,
    },

    // ── Genomic features ────────────────────────────────────────────────────
    {
      id: 'feature-alb-liver',
      tab: 'feature',
      title: 'Is ALB among the top 1% of genes in liver?',
      blurb:
        'Symbol = ALB AND tissue.percentile:UBERON:0002107 >= 99. Symbols are case-sensitive; boolean granularity answers yes/no.',
      request: {
        path: '/features',
        opts: recordOpts([alb, tissueTopFilter(LIVER_ID)], { granularity: 'boolean' }),
      },
      href: exploreHref([alb, liver]),
    },
    {
      id: 'feature-tp53-liver',
      tab: 'feature',
      title: 'Is TP53 among the top 1% of genes in liver?',
      blurb:
        'Same question for TP53 — the answer is no, which is the contrast that makes ALB a liver marker.',
      request: {
        path: '/features',
        opts: recordOpts([tp53, tissueTopFilter(LIVER_ID)], { granularity: 'boolean' }),
      },
      href: exploreHref([tp53, liver]),
    },
    {
      id: 'feature-liver-protein-count',
      tab: 'feature',
      title: 'How many protein-coding genes are top 1% in liver?',
      blurb:
        'feature.biotypeFamily = protein_coding AND tissue.percentile >= 99 in liver, counted rather than listed.',
      request: {
        path: '/features',
        opts: recordOpts([proteinCoding, tissueTopFilter(LIVER_ID)], {
          granularity: 'count',
        }),
      },
      href: exploreHref([liver]),
    },
    {
      id: 'feature-tp53',
      tab: 'feature',
      title: 'Look up the TP53 gene',
      blurb:
        'Alphanumeric filter symbol = TP53 resolves through aliases / gene lookup and returns the genomicFeature records.',
      request: { path: '/features', opts: recordOpts([tp53]) },
      href: exploreHref([tp53]),
    },
    {
      id: 'feature-matrices',
      tab: 'feature',
      title: 'Which matrices measure ALB?',
      blurb:
        'Nested /features/{id}/matrices follows the genomicFeature → matrix link (no filters on nested routes).',
      request: {
        path: `/features/feature-${ALB_ENSEMBL}/matrices`,
        opts: recordOpts(undefined, { limit: 5 }),
      },
    },

    // ── Biosamples ──────────────────────────────────────────────────────────
    {
      id: 'biosample-brain-exists',
      tab: 'biosample',
      title: 'Do we have any brain biosamples?',
      blurb: `Ontology filter ${brain.id} (${brain.label ?? 'brain'}); boolean granularity returns only exists.`,
      request: {
        path: '/biosamples',
        opts: recordOpts([brain], { granularity: 'boolean' }),
      },
      href: exploreHref([brain]),
    },
    {
      id: 'biosample-liver-count',
      tab: 'biosample',
      title: 'How many liver biosamples are there?',
      blurb: 'Ontology filter UBERON:0002107 on the biosample collection, counted.',
      request: {
        path: '/biosamples',
        opts: recordOpts([liver], { granularity: 'count' }),
      },
      href: exploreHref([liver]),
    },
    {
      id: 'biosample-liver',
      tab: 'biosample',
      title: 'Show me liver biosamples',
      blurb: 'Same filter at record granularity: the first page of biosample records.',
      request: { path: '/biosamples', opts: recordOpts([liver]) },
      href: exploreHref([liver]),
    },
    {
      id: 'biosample-matrices',
      tab: 'biosample',
      title: 'Which matrix holds this biosample?',
      blurb: 'Nested /biosamples/{id}/matrices follows the biosample → matrix link.',
      request: {
        path: '/biosamples/GSM3415767/matrices',
        opts: recordOpts(undefined, { limit: 5 }),
      },
    },

    // ── Expression values ───────────────────────────────────────────────────
    {
      id: 'ev-top',
      tab: 'expressionValue',
      title: `Highest expression measurements in ${matrixId}`,
      blurb:
        'order = desc ranks cells by value under query.requestParameters.expressionValue (the only entry type with request parameters).',
      request: {
        path: `${matrixPath}/expression_values`,
        opts: recordOpts(undefined, {
          limit: 5,
          requestParameters: { expressionValue: { order: 'desc', minValue: 1000 } },
        }),
      },
      href: matrixHref,
    },
    {
      id: 'ev-lowest',
      tab: 'expressionValue',
      title: `Lowest detected expression in ${matrixId}`,
      blurb:
        'order = asc with minValue = 0.1 skips zeros and lists the weakest detected measurements first.',
      request: {
        path: `${matrixPath}/expression_values`,
        opts: recordOpts(undefined, {
          limit: 5,
          requestParameters: { expressionValue: { order: 'asc', minValue: 0.1 } },
        }),
      },
      href: matrixHref,
    },
    {
      id: 'ev-alb-count',
      tab: 'expressionValue',
      title: `In how many samples is ALB expressed ≥ 1000 in ${matrixId}?`,
      blurb:
        'featureIDList + minValue under requestParameters.expressionValue, at count granularity: one number, no cells transferred.',
      request: {
        path: `${matrixPath}/expression_values`,
        opts: recordOpts(undefined, {
          granularity: 'count',
          requestParameters: {
            expressionValue: { featureIDList: ALB_ENSEMBL, minValue: 1000 },
          },
        }),
      },
      href: matrixHref,
    },
    {
      id: 'ev-alb-slice',
      tab: 'expressionValue',
      title: `Is ALB highly expressed in ${matrixId}? Top samples`,
      blurb:
        'The same slice as records: ALB values across biosamples, highest first.',
      request: {
        path: `${matrixPath}/expression_values`,
        opts: recordOpts(undefined, {
          limit: 5,
          requestParameters: {
            expressionValue: { featureIDList: ALB_ENSEMBL, order: 'desc' },
          },
        }),
      },
      href: matrixHref,
    },
    ...(lungMatrixId
      ? [
          {
            id: 'ev-alb-lung',
            tab: 'expressionValue',
            title: `Is ALB expressed ≥ 1000 in ${lungMatrixId}?`,
            blurb:
              'The tissue-specificity check: the same boolean question against a lung matrix is false.',
            request: {
              path: `/matrices/${encodeURIComponent(lungMatrixId)}/expression_values`,
              opts: recordOpts(undefined, {
                granularity: 'boolean',
                requestParameters: {
                  expressionValue: { featureIDList: ALB_ENSEMBL, minValue: 1000 },
                },
              }),
            },
            href: `/matrices/?matrix=${encodeURIComponent(lungMatrixId)}`,
          } satisfies HomeQueryExample,
        ]
      : []),

    // ── Explore ─────────────────────────────────────────────────────────────
    {
      id: 'explore-liver',
      tab: 'explore',
      title: 'Which genes define liver? (tissue-first Explore)',
      blurb:
        'A single tissue with no gene filters pages genes by tissue.percentile: top 1% (>= 99) first, then every gene present in the tissue (>= 0).',
      href: exploreHref([liver]),
      request: {
        path: '/features',
        opts: recordOpts([tissueTopFilter(LIVER_ID)]),
      },
      underlying: [
        {
          label: 'Presence continuation (after top page)',
          request: {
            path: '/features',
            opts: recordOpts([tissuePresentFilter(LIVER_ID)]),
          },
        },
      ],
    },
    {
      id: 'explore-alb-liver',
      tab: 'explore',
      title: 'Gene × tissue · ALB in liver',
      blurb:
        'Case-sensitive gene symbol plus tissue — Alb ≠ ALB. Heatmap bands probe tissue.percentile >= 99 for the visible genes.',
      href: exploreHref([alb, liver]),
      request: {
        path: '/features',
        opts: recordOpts([alb, tissuePresentFilter(LIVER_ID)]),
      },
    },
  ]

  return examples
}

export function examplesForTab(
  examples: HomeQueryExample[],
  tab: HomeExampleTab
): HomeQueryExample[] {
  return examples.filter((e) => e.tab === tab)
}
