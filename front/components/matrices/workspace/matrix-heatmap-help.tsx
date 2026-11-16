'use client'

import { HelpPopover } from '@/components/shared/help-popover'

/** Explains how the matrix workspace heatmap is built and which Beacon calls feed it. */
export function MatrixHeatmapHelp() {
  const li = 'list-disc'
  return (
    <HelpPopover label="How this heatmap is built" title="How this heatmap is built">
      <p className="mb-3 text-muted-foreground">
        Rows are genes, columns are samples, cells are expression values from this
        matrix. Every step is a plain Beacon request (see Show API call).
      </p>
      <p className="mb-1 font-medium">1. Resolve your filters (only if you set any)</p>
      <ul className={`mb-3 ${li} space-y-1 pl-4 text-muted-foreground`}>
        <li>
          Gene / sample filters are accepted on collection roots only, so they are
          looked up in this matrix (<code>/matrices/&#123;id&#125;/features</code>,{' '}
          <code>/biosamples</code>) and collapsed to at most ~100 ids per axis.
        </li>
        <li>No filters: the whole matrix is ranked, nothing is resolved.</li>
        <li>An axis that matches nothing shows &ldquo;No cells match&rdquo;.</li>
      </ul>
      <p className="mb-1 font-medium">2. Rank cells by value</p>
      <ul className={`mb-3 ${li} space-y-1 pl-4 text-muted-foreground`}>
        <li>
          <code>/matrices/&#123;id&#125;/expression_values</code> with{' '}
          <code>featureIDList</code>, <code>biosampleIDList</code>,{' '}
          <code>minValue</code> / <code>maxValue</code> and <code>order</code>{' '}
          (Highest / Lowest first), 1000 cells per page, followed by page tokens.
        </li>
        <li>
          Axes come from the ranking: genes and samples appear in the order they first
          show up. A new query starts at 5 genes × 20 samples (small matrices load all
          samples); scrolling or &ldquo;load more&rdquo; extends the window.
        </li>
      </ul>
      <p className="mb-1 font-medium">3. Fill the grid</p>
      <ul className={`mb-3 ${li} space-y-1 pl-4 text-muted-foreground`}>
        <li>
          The ranked page only holds the top cells, so the visible window is densified
          with extra <code>expression_values</code> calls (id lists chunked to server
          limits, a few at a time) and cached.
        </li>
        <li>
          Empty cells mean no value is stored or it is outside the min / max range.
        </li>
        <li>Gene and sample labels are enriched afterwards from the matrix axis lists.</li>
      </ul>
      <p className="mb-1 font-medium">Colours</p>
      <p className="text-muted-foreground">
        The scale uses the matrix&apos;s catalogued value range (min–max, in its unit),
        so colours are comparable across views of the same matrix, not across matrices.
      </p>
    </HelpPopover>
  )
}
