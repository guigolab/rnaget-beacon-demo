export type Granularity = 'boolean' | 'count' | 'record'

export type OntologyFilter = {
  id: string
  scope?: string
}

export type AlphanumericOperator = '=' | '!' | '<' | '>' | '<=' | '>='

export type AlphanumericFilter = {
  id: string
  operator: AlphanumericOperator
  value: string
  scope?: string
}

export type CustomFilter = {
  id: string
  scope?: string
}

export type BeaconFilter = OntologyFilter | AlphanumericFilter | CustomFilter

export type UiFilter =
  | { kind: 'ontology'; id: string; label?: string }
  | { kind: 'symbol'; value: string }
  | { kind: 'sex'; value: string }
  | { kind: 'alphanumeric'; id: string; value: string; label?: string }
  /** Continuous expression.* terms that require an operator (e.g. expression.median). */
  | {
      kind: 'expression'
      id: string
      operator?: string
      value?: string
      label?: string
    }
  | { kind: 'matrixUnit'; value: string }
  /** Includes categorical expression.* ids such as expression.percentile.80-100. */
  | { kind: 'custom'; id: string; label?: string }

export type FilteringTerm = {
  id: string
  label?: string
  type?: string
  scopes?: string[]
  values?: string[]
}

export type FilteringResource = {
  id?: string
  name?: string
  nameSpacePrefix?: string
  iriPrefix?: string
  url?: string
}

export type BeaconMeta = {
  apiVersion?: string
  beaconId?: string
  returnedGranularity?: Granularity
  receivedRequestSummary?: ReceivedRequestSummary
  returnedSchemas?: Array<{ id?: string; name?: string }>
}

export type PaginationSummary = {
  skip?: number
  limit?: number
  nextPage?: string
  previousPage?: string
}

export type ReceivedRequestSummary = {
  apiVersion?: string
  requestedGranularity?: Granularity
  pagination?: PaginationSummary
  filters?: Array<{
    id?: string
    operator?: string
    value?: string
    scope?: string
  }>
  [key: string]: unknown
}

export type BeaconResult<T> = {
  exists: boolean
  total?: number
  results: T[]
  meta: BeaconMeta
  returnedGranularity?: Granularity
  /** Opaque page token when the server returns keyset pagination. */
  nextPage?: string
}

export type BeaconInfo = {
  id?: string
  name?: string
  apiVersion?: string
  environment?: string
  description?: string
  organization?: { id?: string; name?: string } | string
}

export type ServiceInfo = {
  id?: string
  name?: string
  type?: { group?: string; artifact?: string; version?: string }
  description?: string
  organization?: { name?: string; url?: string }
  version?: string
  environment?: string
}

export type EntryTypeSchemaRef = {
  id?: string
  name?: string
  referenceToSchemaDefinition?: string
  schemaVersion?: string
}

export type EntryTypeInfo = {
  id?: string
  name?: string
  description?: string
  partOfSpecification?: string
  defaultSchema?: EntryTypeSchemaRef
  ontologyTermForThisType?: OntologyTerm
}

export type BeaconMapEndpoint = {
  returnedEntryType?: string
  url?: string
}

export type BeaconMapEndpointSet = {
  entryType?: string
  rootUrl?: string
  singleEntryUrl?: string
  filteringTermsUrl?: string
  endpoints?: Record<string, BeaconMapEndpoint>
}

export type BeaconMap = {
  endpointSets?: Record<string, BeaconMapEndpointSet>
}

export type BeaconConfiguration = {
  maturityAttributes?: { productionStatus?: string }
  securityAttributes?: {
    defaultGranularity?: Granularity | string
    securityLevels?: string[]
  }
  entryTypes?: Record<string, EntryTypeInfo>
}

export type Matrix = {
  matrixId: string
  name?: string
  description?: string
  expressionUnitAndScale?: { unit?: string; scale?: string }
  expressionValueRange?: { min?: number; max?: number }
  assembly?: { name?: string; accession?: string }
  dimensions?: { features?: number; biosamples?: number }
  assayType?: OntologyTerm
  featureType?: OntologyTerm | OntologyTerm[]
  annotation?: { source?: string; version?: string; file?: string }
  downloadUrl?: string
  reproducible?: boolean
}

export type GenomicInterval = {
  strand?: string
  location?: {
    sequence_id?: string
    interval?: {
      start?: { value?: number }
      end?: { value?: number }
    }
  }
}

/** Embedded info.expressionSummary from packaged expression stats (not a summary endpoint). */
export type ExpressionSummaryInfo = {
  min?: number
  max?: number
  /** Feature-axis embed: biosample holding the min/max. */
  minBiosampleId?: string
  maxBiosampleId?: string
  /** Biosample-axis embed: feature holding the min/max. */
  minFeatureId?: string
  maxFeatureId?: string
}

/** @deprecated Prefer ExpressionSummaryInfo */
export type FeatureExpressionSummaryInfo = ExpressionSummaryInfo

export type Feature = {
  id: string
  genomicFeature?: {
    featureIdentifier?: { id?: string; resource?: string }
    featureType?: OntologyTerm
    aliases?: string[]
    xrefs?: string[]
    ontologyTerms?: OntologyTerm[]
    genomicInterval?: GenomicInterval
  }
  matrixIds?: string[]
  /** Present on nested `/matrices/{id}/features` when expression stats are packaged. */
  info?: {
    expressionSummary?: ExpressionSummaryInfo
  }
}

export type OntologyTerm = { id?: string; label?: string }

export type PhenotypicFeature = {
  featureType?: OntologyTerm
  severity?: OntologyTerm
  notes?: string
}

export type Measurement = {
  assayCode?: OntologyTerm
  measurementValue?: { unit?: OntologyTerm; value?: number }
  notes?: string
}

export type Biosample = {
  id: string
  individualId?: string
  biosampleStatus?: string | OntologyTerm
  organism?: { scientificName?: string }
  collectionMoment?: string
  collectionDate?: string
  matrixIds?: string[]
  description?: string
  summary?: string
  notes?: string
  sex?: string
  sampleOriginType?: OntologyTerm
  sampleOriginDetail?: OntologyTerm
  sampleProcessing?: OntologyTerm
  sampleType?: OntologyTerm
  phenotypicFeatures?: PhenotypicFeature[]
  measurements?: Measurement[]
  info?: {
    sex?: string
    lab?: string
    age_bracket?: string
    condition?: string
    timepoint?: string
    rin?: number
    ischemic_time_min?: number
    /** Present on nested `/matrices/{id}/biosamples` when expression stats are packaged. */
    expressionSummary?: ExpressionSummaryInfo
  }
}

export type ExpressionValue = {
  id: string
  matrixId: string
  featureId: string
  biosampleId: string
  value: number
}

export const MAX_COHORT = 200

export const FALLBACK_MATRIX_IDS = [
  'ENCSR622FSM',
  'GSE164073',
  'GTEx-v8-Adipose-Subcutaneous',
]
