'use client'

import { HelpPopover, HelpSection } from '@/components/shared/help-popover'

/** Explore help: what the heatmap shows, how it is built, then what "top 1%" means. */
export function PercentileHelp() {
  return (
    <HelpPopover label="How to read this heatmap" title="How to read this heatmap">
      <HelpSection title="What you see">
        <p>
          Rows are genes, columns are tissues. Each cell answers: is
          this gene among the most expressed genes in this tissue?
        </p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <b>Top 1%</b>: in the top 1% of genes of that tissue.
          </li>
          <li>
            <b>Present</b>: detected in that tissue, but below the top 1%.
          </li>
          <li>
            <b>Not in any matrix</b>: never measured in that tissue.
          </li>
        </ul>
      </HelpSection>

      <HelpSection title="How it is built">
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            <b>Genes</b>: <code>POST /features</code> with your gene filters. If you
            picked a tissue, its top 1% genes come first, then the other genes detected
            in it (<code>tissue.percentile &gt;= 0</code>).
          </li>
          <li>
            <b>Measured or not?</b> Checked locally, comparing the gene&apos;s matrices
            with the matrices that contain the tissue (from <code>GET /matrices</code>).
            No overlap means Not in any matrix, with no request.
          </li>
          <li>
            <b>Top 1% or Present?</b> One yes/no <code>POST /features</code> per cell,
            with the gene&apos;s symbol and resource plus{' '}
            <code>tissue.percentile:&lt;tissue&gt; &gt;= 99</code>. Yes is Top 1%, no is
            Present.
          </li>
        </ol>
        <p className="text-muted-foreground">
          Cells fill in as answers arrive, and each answer is cached.
        </p>
      </HelpSection>

      <HelpSection title="What “top 1%” means">
        <p>
          A percentile ranks a gene by its <b>median</b> expression over a group of
          samples (99 = top 1%). Only genes with a median above 0 are ranked. Two
          different top-1% sets exist.
        </p>
        <p>
          <b>Tissue top 1% (the cells)</b>: ranked per tissue, using only that
          tissue&apos;s samples. If several matrices cover the tissue, the one with the
          most samples is used.
        </p>
        <p>
          <b>General top 1% (the &ldquo;Top 1% of genes&rdquo; chips)</b>: ranked per
          matrix, using all its samples. A gene is in the set if it is top 1% in at
          least one matrix. Tissues play no role.
        </p>
        <p className="text-muted-foreground">
          The two are independent: a gene can be in one and not the other.
        </p>
      </HelpSection>
    </HelpPopover>
  )
}
