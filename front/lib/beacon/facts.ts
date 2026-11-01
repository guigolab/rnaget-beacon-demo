import type { Biosample, Feature, FilteringResource, Matrix, OntologyTerm } from './types'

export type FactLink = { text: string; href?: string }

export type Fact = { label: string; value?: string | null; links?: FactLink[] }

function termText(term?: OntologyTerm | string | null): string | undefined {
  if (!term) return undefined
  if (typeof term === 'string') return term
  if (term.label && term.id) return `${term.label} (${term.id})`
  return term.label || term.id
}

export function curieHref(resources: FilteringResource[], id: string): string | undefined {
  const split = id.split(':')
  if (split.length < 2) return undefined
  const prefix = split[0] ?? ''
  const local = split.slice(1).join(':')
  if (!prefix || !local) return undefined
  const resource = resources.find((item) => {
    const space = (item.nameSpacePrefix ?? '').toUpperCase()
    const rid = (item.id ?? '').toUpperCase()
    const want = prefix.toUpperCase()
    return space === want || rid === want || space.replace('_', '') === want.replace('_', '')
  })
  if (!resource?.iriPrefix) return undefined
  return `${resource.iriPrefix}${local}`
}

function linkedTerms(
  resources: FilteringResource[],
  items: Array<{ id?: string; label?: string } | string>
): FactLink[] {
  const links: FactLink[] = []
  for (const item of items) {
    const id = typeof item === 'string' ? item : item.id
    const label = typeof item === 'string' ? item : item.label
    if (!id && !label) continue
    const text = id && label && label !== id ? `${label} (${id})` : label || id || ''
    links.push({ text, href: id ? curieHref(resources, id) : undefined })
  }
  return links
}
function join(values: Array<string | undefined>): string | undefined {
  const text = values.filter((value): value is string => Boolean(value && value.trim()))
  return text.length ? text.join(', ') : undefined
}

function formatInterval(feature: Feature): string | undefined {
  const interval = feature.genomicFeature?.genomicInterval
  const location = interval?.location
  if (!location?.sequence_id) return undefined
  const start = location.interval?.start?.value
  const end = location.interval?.end?.value
  const range = start != null && end != null ? `${start.toLocaleString()}–${end.toLocaleString()}` : undefined
  return [location.sequence_id, range, interval?.strand].filter(Boolean).join(' · ')
}

export function featureFacts(feature: Feature, resources: FilteringResource[] = []): Fact[] {
  const genomic = feature.genomicFeature
  const type = genomic?.featureType
  const ontology = linkedTerms(resources, genomic?.ontologyTerms ?? [])
  const xrefs = linkedTerms(resources, genomic?.xrefs ?? [])
  const typeLinks = type?.id ? linkedTerms(resources, [type]) : []
  return [
    {
      label: 'Feature type',
      value: typeLinks.some((link) => link.href) ? undefined : termText(type),
      links: typeLinks.some((link) => link.href) ? typeLinks : undefined,
    },
    { label: 'Native ID', value: genomic?.featureIdentifier?.id },
    { label: 'Resource', value: genomic?.featureIdentifier?.resource },
    { label: 'Aliases', value: join(genomic?.aliases ?? []) },
    { label: 'Location', value: formatInterval(feature) },
    { label: 'Ontology', links: ontology.length ? ontology : undefined },
    { label: 'Cross references', links: xrefs.length ? xrefs : undefined },
  ]
}

export function biosampleFacts(sample: Biosample): Fact[] {
  const sex = sample.sex ?? sample.info?.sex
  return [
    { label: 'Origin', value: termText(sample.sampleOriginType) },
    { label: 'Origin detail', value: termText(sample.sampleOriginDetail) },
    { label: 'Sample type', value: termText(sample.sampleType) },
    { label: 'Status', value: termText(sample.biosampleStatus) },
    { label: 'Sex', value: sex },
    { label: 'Individual', value: sample.individualId },
    { label: 'Collection', value: sample.collectionMoment },
    { label: 'Organism', value: sample.organism?.scientificName },
    { label: 'Lab', value: sample.info?.lab },
    { label: 'Description', value: sample.description ?? sample.summary },
    { label: 'Notes', value: sample.notes },
  ]
}

function featureTypeText(matrix: Matrix): string | undefined {
  const value = matrix.featureType
  if (!value) return undefined
  const terms = Array.isArray(value) ? value : [value]
  return join(terms.map((term) => termText(term)))
}

export function ncbiAssemblyFtp(accession?: string, name?: string): string | undefined {
  if (!accession) return undefined
  const match = /^([A-Za-z]+)_(\d+)\.\d+$/.exec(accession)
  if (!match) return undefined
  const prefix = match[1]
  const digits = match[2] ?? ''
  const groups = digits.match(/.{1,3}/g)
  if (!prefix || !groups || groups.join('') !== digits) return undefined
  const folder = name ? `${accession}_${name.trim().replace(/\s+/g, '_')}` : accession
  return `https://ftp.ncbi.nlm.nih.gov/genomes/all/${prefix}/${groups.join('/')}/${folder}/`
}

export function matrixDownloads(matrix: Matrix): FactLink[] {
  const links: FactLink[] = []
  if (matrix.downloadUrl) links.push({ text: 'Matrix file', href: matrix.downloadUrl })
  if (matrix.annotation?.file) {
    links.push({ text: 'Gene annotation', href: matrix.annotation.file })
  }
  const assembly = ncbiAssemblyFtp(matrix.assembly?.accession, matrix.assembly?.name)
  if (assembly) links.push({ text: 'Assembly', href: assembly })
  return links
}
export function matrixFacts(matrix: Matrix): Fact[] {
  const unit = [matrix.expressionUnitAndScale?.unit, matrix.expressionUnitAndScale?.scale]
    .filter(Boolean)
    .join(', ')
  const range = matrix.expressionValueRange
  const rangeText =
    range && (range.min != null || range.max != null)
      ? `${range.min ?? '—'} – ${range.max ?? '—'}`
      : undefined
  const dimensions =
    matrix.dimensions?.features != null || matrix.dimensions?.biosamples != null
      ? `${matrix.dimensions?.features?.toLocaleString() ?? '—'} features × ${matrix.dimensions?.biosamples?.toLocaleString() ?? '—'} biosamples`
      : undefined
  const annotation = [matrix.annotation?.source, matrix.annotation?.version].filter(Boolean).join(' ')
  const assembly = [matrix.assembly?.name, matrix.assembly?.accession].filter(Boolean).join(' · ')
  return [
    { label: 'Assay', value: termText(matrix.assayType) },
    { label: 'Feature type', value: featureTypeText(matrix) },
    { label: 'Annotation', value: annotation },
    { label: 'Assembly', value: assembly },
    { label: 'Unit and scale', value: unit },
    { label: 'Value range', value: rangeText },
    { label: 'Dimensions', value: dimensions },
    { label: 'Reproducible', value: matrix.reproducible == null ? undefined : matrix.reproducible ? 'Yes' : 'No' },
  ]
}
