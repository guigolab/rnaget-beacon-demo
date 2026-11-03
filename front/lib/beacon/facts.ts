import type { Biosample, Feature, FilteringResource, Matrix, OntologyTerm } from './types'

export type FactLink = { text: string; href?: string }

export type Fact = { label: string; value?: string | null; links?: FactLink[] }

function termText(term?: OntologyTerm | string | null): string | undefined {
  if (!term) return undefined
  if (typeof term === 'string') return term
  if (term.label && term.id) return `${term.label} (${term.id})`
  return term.label || term.id
}

function termFactFields(
  resources: FilteringResource[],
  term?: OntologyTerm | string | null
): Pick<Fact, 'value' | 'links'> {
  if (!term) return {}
  const links = linkedTerms(
    resources,
    typeof term === 'string' ? [term] : [term]
  )
  if (!links.length) return { value: termText(term) }
  if (links.some((link) => link.href)) {
    return { links }
  }
  return { value: termText(term) }
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

export function linkedTerms(
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

/** Scalar fields for detail drawer (chips cover aliases/xrefs/ontology). */
export function featureScalarFacts(
  feature: Feature,
  resources: FilteringResource[] = []
): Fact[] {
  const genomic = feature.genomicFeature
  const type = genomic?.featureType
  const typeLinks = type?.id ? linkedTerms(resources, [type]) : []
  return [
    {
      label: 'Feature type',
      value: typeLinks.some((link) => link.href) ? undefined : termText(type),
      links: typeLinks.some((link) => link.href) ? typeLinks : undefined,
    },
    { label: 'Native ID', value: genomic?.featureIdentifier?.id },
    { label: 'Resource', value: genomic?.featureIdentifier?.resource },
    { label: 'Location', value: formatInterval(feature) },
  ]
}

/** Clinical / info fields after ontology sections in biosample drawer. */
export function biosampleInfoScalarFacts(sample: Biosample): Fact[] {
  const sex = sample.sex ?? sample.info?.sex
  const info = sample.info ?? {}
  return [
    { label: 'Sex', value: sex != null ? String(sex) : undefined },
    { label: 'Individual', value: sample.individualId },
    { label: 'Collection date', value: sample.collectionDate },
    { label: 'Collection', value: sample.collectionMoment },
    {
      label: 'Condition',
      value: info.condition != null ? String(info.condition) : undefined,
    },
    {
      label: 'Timepoint',
      value: info.timepoint != null ? String(info.timepoint) : undefined,
    },
    {
      label: 'Age bracket',
      value: info.age_bracket != null ? String(info.age_bracket) : undefined,
    },
    { label: 'RIN', value: info.rin != null ? String(info.rin) : undefined },
    {
      label: 'Ischemic time (min)',
      value:
        info.ischemic_time_min != null ? String(info.ischemic_time_min) : undefined,
    },
    { label: 'Organism', value: sample.organism?.scientificName },
    { label: 'Lab', value: info.lab != null ? String(info.lab) : undefined },
    { label: 'Description', value: sample.description ?? sample.summary },
    { label: 'Notes', value: sample.notes },
  ]
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

export function biosampleFacts(
  sample: Biosample,
  resources: FilteringResource[] = []
): Fact[] {
  const sex = sample.sex ?? sample.info?.sex
  const info = sample.info ?? {}

  const phenotypeLinks: FactLink[] = []
  for (const pf of sample.phenotypicFeatures ?? []) {
    if (pf.featureType?.id || pf.featureType?.label) {
      phenotypeLinks.push(...linkedTerms(resources, [pf.featureType]))
    }
    if (pf.severity?.id || pf.severity?.label) {
      phenotypeLinks.push(...linkedTerms(resources, [pf.severity]))
    }
    if (pf.notes?.trim()) {
      phenotypeLinks.push({ text: pf.notes.trim() })
    }
  }

  const measurementLinks: FactLink[] = []
  for (const m of sample.measurements ?? []) {
    const assay = m.assayCode
    const val = m.measurementValue?.value
    const unit = m.measurementValue?.unit
    if (assay?.id || assay?.label) {
      const assayLinks = linkedTerms(resources, [assay])
      const prefix = assayLinks[0]?.text ?? termText(assay)
      if (val != null) {
        const unitText = termText(unit)
        const unitLink =
          unit && typeof unit === 'object' && unit.id
            ? curieHref(resources, unit.id)
            : undefined
        measurementLinks.push({
          text: unitText ? `${prefix}: ${val} ${unitText}` : `${prefix}: ${val}`,
          href: assayLinks[0]?.href ?? unitLink,
        })
      } else if (assayLinks[0]) {
        measurementLinks.push(assayLinks[0])
      }
    }
  }

  return [
    { label: 'Status', ...termFactFields(resources, sample.biosampleStatus) },
    { label: 'Origin', ...termFactFields(resources, sample.sampleOriginType) },
    {
      label: 'Origin detail',
      ...termFactFields(resources, sample.sampleOriginDetail),
    },
    {
      label: 'Processing',
      ...termFactFields(resources, sample.sampleProcessing),
    },
    { label: 'Sample type', ...termFactFields(resources, sample.sampleType) },
    {
      label: 'Phenotypes',
      links: phenotypeLinks.length ? phenotypeLinks : undefined,
    },
    {
      label: 'Measurements',
      links: measurementLinks.length ? measurementLinks : undefined,
    },
    { label: 'Sex', value: sex },
    { label: 'Individual', value: sample.individualId },
    { label: 'Collection date', value: sample.collectionDate },
    { label: 'Collection', value: sample.collectionMoment },
    { label: 'Condition', value: info.condition != null ? String(info.condition) : undefined },
    { label: 'Timepoint', value: info.timepoint != null ? String(info.timepoint) : undefined },
    { label: 'Age bracket', value: info.age_bracket != null ? String(info.age_bracket) : undefined },
    {
      label: 'RIN',
      value: info.rin != null ? String(info.rin) : undefined,
    },
    {
      label: 'Ischemic time (min)',
      value:
        info.ischemic_time_min != null ? String(info.ischemic_time_min) : undefined,
    },
    { label: 'Organism', value: sample.organism?.scientificName },
    { label: 'Lab', value: info.lab != null ? String(info.lab) : undefined },
    { label: 'Description', value: sample.description ?? sample.summary },
    { label: 'Notes', value: sample.notes },
  ]
}

function featureTypeText(matrix: Matrix): string | undefined {
  const value = matrix.featureTypes ?? matrix.featureType
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
