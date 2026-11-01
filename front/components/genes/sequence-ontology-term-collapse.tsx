'use client'

import { NamespaceTermCollapse } from '@/components/shared/namespace-term-collapse'
import type { UiFilter } from '@/lib/beacon'
import type { NamespaceScopeGroup } from '@/lib/scope-theme'

type SequenceOntologyTermCollapseProps = {
  group: NamespaceScopeGroup
  activeFilters: UiFilter[]
  onAddFilter: (filter: UiFilter) => void
  resourceName?: string
}

export function SequenceOntologyTermCollapse(props: SequenceOntologyTermCollapseProps) {
  return <NamespaceTermCollapse {...props} scope="genomicFeature" />
}
