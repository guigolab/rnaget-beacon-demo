export type Granularity = 'boolean' | 'count' | 'record'

export type OntologyFilter = {
  id: string
  scope?: string
}

export type AlphanumericFilter = {
  id: string
  operator: '=' | '!'
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
  | { kind: 'matrixUnit'; value: string }
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

export type ReceivedRequestSummary = {
  apiVersion?: string
  requestedGranularity?: Granularity
  pagination?: { skip?: number; limit?: number }
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
}

export type BeaconInfo = {
  id?: string
  name?: string
  apiVersion?: string
  environment?: string
  description?: string
  organization?: { id?: string; name?: string } | string
}

export type EntryTypeInfo = {
  id?: string
  name?: string
  description?: string
  partOfSpecification?: string
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
