import type { Biosample } from '@/lib/beacon/types'
import {
  groupBiosamplesIntoMatrixStrips,
  type BiosampleMatrixStrip,
} from '@/lib/sample-lens'

export type { BiosampleMatrixStrip }

export function stripsForBiosamplePage(
  samples: Biosample[],
  focusMatrix?: string | null
): BiosampleMatrixStrip[] {
  return groupBiosamplesIntoMatrixStrips(samples, focusMatrix)
}
