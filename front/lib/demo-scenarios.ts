export type DemoScenario = {
  id: string
  label: string
  href: string
  description: string
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'alb-gtex',
    label: 'ALB · liver vs adipose',
    href: '/genes/ALB',
    description: 'GTEx tissue contrast for albumin.',
  },
  {
    id: 'ace2-geo',
    label: 'ACE2 · cornea COVID',
    href: '/genes/ACE2?matrix=GSE164073',
    description: 'GEO GSE164073 eye infection series.',
  },
  {
    id: 'compare-gtex',
    label: 'Compare GTEx tissues',
    href: '/compare?genes=ALB,APOA1,LEP&matrices=GTEx-v8-Liver,GTEx-v8-Adipose-Subcutaneous',
    description: 'Cross-matrix panel with comparability badges.',
  },
  {
    id: 'datasets',
    label: 'Dataset catalog',
    href: '/datasets',
    description: 'Facet matrices by unit, annotation, and assay.',
  },
]
