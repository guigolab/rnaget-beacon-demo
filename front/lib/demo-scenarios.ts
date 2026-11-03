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
    href: '/features/?filters=symbol:ALB',
    description: 'GTEx tissue contrast for albumin.',
  },
  {
    id: 'ace2-geo',
    label: 'ACE2 · cornea COVID',
    href: '/features/?filters=symbol:ACE2&matrix=GSE164073',
    description: 'GEO GSE164073 eye infection series.',
  },
  {
    id: 'gtex-heatmap',
    label: 'ALB · GTEx heatmap',
    href: '/features/?filters=symbol:ALB&unit=TPM',
    description: 'Cross-matrix compare via features heatmap (compatible TPM unit).',
  },
  {
    id: 'matrices-tpm',
    label: 'TPM matrices',
    href: '/matrices/?matrix.unit=TPM',
    description: 'Matrix lens catalog filtered by expression unit.',
  },
]
