import {
  FEATURE_BIOTYPE_FAMILY_ID,
  FALLBACK_MATRIX_IDS,
  isFeatureLensFilter,
  matrixProfileSourceCustomFilter,
  scopeOf,
  symbolCustomFilter,
  type FilteringTerm,
  type UiFilter,
} from '@/lib/beacon'
import type { QueryOptions } from '@/lib/beacon/query'
import { exploreLensSearchParams } from '@/lib/explore-lens'
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

function pickOntology(
  terms: FilteringTerm[],
  id: string,
  scope: string
): FilteringTerm | undefined {
  return terms.find(
    (t) => t.id === id && (t.scopes?.includes(scope) ?? false)
  )
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
 */
export function buildHomeQueryExamples(opts: {
  terms?: FilteringTerm[]
  matrixIds?: string[]
}): HomeQueryExample[] {
  const terms = opts.terms ?? []
  const matrixId = preferredMatrixId(opts.matrixIds ?? [])

  const geneExamples = geneLensQueryExamples(terms)
  const sampleExamples = sampleLensQueryExamples(terms)
  const matrixExamples = matrixLensQueryExamples(terms)

  const tp53 =
    geneExamples.find((e) => e.label === 'TP53')?.filter ??
    symbolCustomFilter('TP53')
  const proteinCoding =
    geneExamples.find((e) => /protein-coding/i.test(e.label))?.filter ??
    ({
      kind: 'alphanumeric',
      id: FEATURE_BIOTYPE_FAMILY_ID,
      value: 'protein_coding',
      label: 'Gene type = protein_coding',
    } satisfies UiFilter)
  const top1 =
    geneExamples.find((e) => /top 1%/i.test(e.label))?.filter ??
    ({
      kind: 'expression',
      id: 'expression.percentile',
      operator: '>=',
      value: '99',
      label: 'Top 1% of genes',
    } satisfies UiFilter)

  const liver =
    sampleExamples.find((e) => /liver/i.test(e.label))?.filter ??
    ({
      kind: 'ontology',
      id: 'UBERON:0002107',
      label: 'liver',
    } satisfies UiFilter)
  const brain =
    sampleExamples.find((e) => /brain/i.test(e.label))?.filter ??
    pickOntology(terms, 'UBERON:0000955', 'biosample')
      ? {
          kind: 'ontology' as const,
          id: 'UBERON:0000955',
          label: 'brain',
        }
      : ({
          kind: 'ontology',
          id: 'UBERON:0002048',
          label: 'lung',
        } satisfies UiFilter)

  const tpm =
    matrixExamples.find((e) => e.label === 'TPM')?.filter ??
    ({
      kind: 'alphanumeric',
      id: 'matrix.unit',
      value: 'TPM',
      label: 'unit = TPM',
    } satisfies UiFilter)
  const gtex =
    matrixExamples.find((e) => /gtex/i.test(e.label))?.filter ??
    matrixProfileSourceCustomFilter('gtex', 'profileSource = GTEx')
  const assay =
    matrixExamples.find((e) => /bulk rna/i.test(e.label))?.filter ??
    ({
      kind: 'ontology',
      id: 'OBI:0003090',
      label: 'bulk RNA-seq assay',
    } satisfies UiFilter)

  const alb = symbolCustomFilter('ALB')

  const examples: HomeQueryExample[] = [
    {
      id: 'matrix-tpm',
      tab: 'matrix',
      title: 'Matrices in TPM',
      blurb: 'Alphanumeric filter on matrix.unit — forces POST when operators are present.',
      request: {
        path: '/matrices',
        opts: recordOpts([tpm]),
      },
      href: '/matrices/',
    },
    {
      id: 'matrix-gtex',
      tab: 'matrix',
      title: 'GTEx profile source',
      blurb: 'Custom filter matrix.profileSource:gtex against the matrix collection.',
      request: {
        path: '/matrices',
        opts: recordOpts([gtex]),
      },
      href: '/matrices/',
    },
    {
      id: 'matrix-assay',
      tab: 'matrix',
      title: 'Bulk RNA-seq assay',
      blurb: 'Ontology filter OBI:0003090 on the matrix entry type.',
      request: {
        path: '/matrices',
        opts: recordOpts([assay]),
      },
      href: '/matrices/',
    },
    {
      id: 'matrix-single',
      tab: 'matrix',
      title: `Single matrix · ${matrixId}`,
      blurb: 'GET one matrix by id (Beacon single-entry path).',
      request: {
        path: `/matrices/${encodeURIComponent(matrixId)}`,
        opts: recordOpts(undefined, { limit: 1 }),
      },
      href: `/matrices/${encodeURIComponent(matrixId)}/`,
    },
    {
      id: 'feature-tp53',
      tab: 'feature',
      title: 'Gene symbol TP53',
      blurb: 'Custom filter symbol:TP53 — gene symbols are case-sensitive.',
      request: {
        path: '/features',
        opts: recordOpts([tp53]),
      },
      href: exploreHref([tp53]),
    },
    {
      id: 'feature-protein',
      tab: 'feature',
      title: 'Protein-coding genes',
      blurb: 'Alphanumeric feature.biotypeFamily = protein_coding.',
      request: {
        path: '/features',
        opts: recordOpts([proteinCoding]),
      },
    },
    {
      id: 'feature-top1',
      tab: 'feature',
      title: 'Top 1% by expression',
      blurb: 'expression.percentile >= 99 across the package.',
      request: {
        path: '/features',
        opts: recordOpts([top1]),
      },
    },
    {
      id: 'feature-matrices',
      tab: 'feature',
      title: 'Matrices for a feature',
      blurb: 'Nested /features/{id}/matrices — genomicFeature → matrix link.',
      request: {
        path: '/features/feature-ENSG00000141510.16/matrices',
        opts: recordOpts(undefined, { limit: 5 }),
      },
    },
    {
      id: 'biosample-liver',
      tab: 'biosample',
      title: 'Liver biosamples',
      blurb: 'UBERON:0002107 ontology filter on the biosample collection.',
      request: {
        path: '/biosamples',
        opts: recordOpts([liver]),
      },
      href: exploreHref([liver]),
    },
    {
      id: 'biosample-brain',
      tab: 'biosample',
      title: `${'label' in brain && brain.label ? brain.label : 'Tissue'} biosamples`,
      blurb: `Ontology filter ${brain.id} on biosamples.`,
      request: {
        path: '/biosamples',
        opts: recordOpts([brain]),
      },
      href: exploreHref([brain]),
    },
    {
      id: 'biosample-matrices',
      tab: 'biosample',
      title: 'Matrices for a biosample',
      blurb: 'Nested /biosamples/{id}/matrices — sample → matrix link.',
      request: {
        path: '/biosamples/GSM3415767/matrices',
        opts: recordOpts(undefined, { limit: 5 }),
      },
    },
    {
      id: 'ev-top',
      tab: 'expressionValue',
      title: 'Highest expression cells',
      blurb:
        'Nested expressionValue only — order=desc and minValue under query.requestParameters.',
      request: {
        path: `/matrices/${encodeURIComponent(matrixId)}/expression_values`,
        opts: recordOpts(undefined, {
          limit: 5,
          requestParameters: { order: 'desc', minValue: 1000 },
        }),
      },
      href: `/matrices/${encodeURIComponent(matrixId)}/`,
    },
    {
      id: 'ev-slice',
      tab: 'expressionValue',
      title: 'Feature × biosample slice',
      blurb:
        'featureIDList + biosampleIDList under requestParameters (Beacon matrix slice).',
      request: {
        path: `/matrices/${encodeURIComponent(matrixId)}/expression_values`,
        opts: recordOpts(undefined, {
          limit: 5,
          requestParameters: {
            featureIDList: 'ENSG00000141510.16',
            order: 'desc',
          },
        }),
      },
      href: `/matrices/${encodeURIComponent(matrixId)}/`,
    },
    {
      id: 'explore-liver',
      tab: 'explore',
      title: 'Tissue-first Explore · liver',
      blurb:
        'Single tissue with no gene filters seeds tissueTop then tissuePresent gene pages.',
      href: exploreHref([liver]),
      request: {
        path: '/features',
        opts: recordOpts([
          {
            kind: 'custom',
            id: 'tissueTop:UBERON:0002107',
            label: 'Top 1% in UBERON:0002107',
          },
        ]),
      },
      underlying: [
        {
          label: 'Presence continuation (after top page)',
          request: {
            path: '/features',
            opts: recordOpts([
              {
                kind: 'custom',
                id: 'tissuePresent:UBERON:0002107',
                label: 'Present in UBERON:0002107',
              },
            ]),
          },
        },
      ],
    },
    {
      id: 'explore-alb-liver',
      tab: 'explore',
      title: 'Gene × tissue · ALB in liver',
      blurb:
        'Case-sensitive gene symbol plus tissue — Alb ≠ ALB. Heatmap bands probe tissueTop for visible cells.',
      href: exploreHref([alb, liver]),
      request: {
        path: '/features',
        opts: recordOpts([
          alb,
          {
            kind: 'custom',
            id: 'tissuePresent:UBERON:0002107',
            label: 'Present in UBERON:0002107',
          },
        ]),
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
