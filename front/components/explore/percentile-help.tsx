'use client'

import { HelpPopover, HelpSection } from '@/components/shared/help-popover'

/** Explains the heatmap cell colours and how the genes / bands are queried. */
export function PercentileHelp() {
  return (
    <HelpPopover label="How to read this heatmap" title="How to read this heatmap">
      <p className="text-muted-foreground">
        Each cell asks one question: is this gene among the most expressed genes in this
        tissue?
      </p>

      <HelpSection title="Cell colours">
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <b>Top 1%</b>: the gene is in the top 1% of genes in that tissue
            (<code>tissue.percentile:&lt;tissue&gt; &gt;= 99</code>).
          </li>
          <li>
            <b>Present</b>: measured in that tissue but below the top 1%.
          </li>
          <li>
            <b>Not in any matrix</b>: no loaded matrix measures the gene in that tissue.
          </li>
        </ul>
      </HelpSection>

      <HelpSection title="How the percentile is computed">
        <p>
          For each matrix and tissue, the expression of every gene is summarised by its
          median over that tissue&apos;s samples. Genes with a median above 0 are ranked
          against each other inside the tissue (0 to 100). Genes with median 0 are
          measured but not detected.
        </p>
        <p className="text-muted-foreground">
          If several matrices cover a tissue, the one with the most samples is used.
          Tissues with few samples are less reliable than large ones.
        </p>
      </HelpSection>

      <HelpSection title="Queries behind the page">
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <b>Gene list</b>: <code>POST /features</code> with your gene filters. Picking
            a tissue also lists its top 1% genes first, then the genes detected in it
            (<code>tissue.percentile &gt;= 0</code>).
          </li>
          <li>
            <b>Each cell</b>: one boolean <code>POST /features</code> (symbol + resource
            + <code>tissue.percentile &gt;= 99</code>). Presence is checked locally from
            the matrices&apos; tissues, so absent cells cost no request.
          </li>
          <li>
            <b>Gene chips</b> &ldquo;Top 1% / Top 10% of genes&rdquo; filter by{' '}
            <code>expression.percentile</code>, the gene&apos;s rank within a matrix.
          </li>
        </ul>
      </HelpSection>
    </HelpPopover>
  )
}
