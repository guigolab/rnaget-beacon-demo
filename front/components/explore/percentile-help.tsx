'use client'

import { HelpPopover } from '@/components/shared/help-popover'

/** Help popover summarising how the percentiles behind the heatmap are computed. */
export function PercentileHelp() {
  return (
    <HelpPopover
      label="How percentiles are computed"
      title="How percentiles are computed"
    >
          <p className="mb-2 font-medium">Tissue-specific (heatmap bands)</p>
          <ul className="mb-3 list-disc space-y-1 pl-4 text-muted-foreground">
            <li>Each sample belongs to one tissue column (its UBERON/EFO id).</li>
            <li>
              For every gene and tissue we take the <b>median</b> expression over that
              tissue&apos;s samples, per matrix.
            </li>
            <li>
              Genes with median &gt; 0 are ranked within the tissue:{' '}
              <code>percent_rank × 100</code>. Median 0 means measured but not detected.
            </li>
            <li>
              <code>tissue.percentile:&lt;tissue&gt; &gt;= 99</code> = top 1% (the
              &ldquo;top 1%&rdquo; band); <code>&gt;= 0</code> = detected (&ldquo;present&rdquo;);
              no row = not measured in any matrix.
            </li>
            <li>
              Across matrices, the one with the most samples for that tissue wins.
            </li>
          </ul>
          <p className="mb-2 font-medium">Not tissue-specific</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            <li>
              <code>expression.percentile</code> (90/95/99): rank of a gene&apos;s median
              among detected genes of a matrix; at the root, a gene matches if any matrix
              meets the threshold.
            </li>
            <li>
              Cell level: <code>percentileInFeature</code> ranks a value among that
              gene&apos;s samples; <code>percentileInBiosample</code> among that
              sample&apos;s genes.
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            Percentiles are relative to each tissue&apos;s own gene set, so tissues with few
            samples are not directly comparable to large ones.
          </p>
    </HelpPopover>
  )
}
