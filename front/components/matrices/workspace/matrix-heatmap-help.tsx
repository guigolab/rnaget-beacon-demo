'use client'

import { HelpPopover, HelpSection } from '@/components/shared/help-popover'

/** Explains how the matrix workspace heatmap is built and which Beacon calls feed it. */
export function MatrixHeatmapHelp() {
  return (
    <HelpPopover label="How this heatmap is built" title="How this heatmap is built">
      <p className="text-muted-foreground">
        Rows are genes, columns are samples, cells are expression values of this matrix.
        Open &ldquo;Show API call&rdquo; to see each request.
      </p>

      <HelpSection title="1. Your filters">
        <p>
          Gene and sample filters are resolved inside this matrix
          (<code>/matrices/&#123;id&#125;/features</code> and <code>/biosamples</code>)
          into up to about 100 ids per axis. With no filters the whole matrix is used.
        </p>
      </HelpSection>

      <HelpSection title="2. Ranking">
        <p>
          <code>/matrices/&#123;id&#125;/expression_values</code> returns the cells
          ordered by value (&ldquo;Sort&rdquo;), restricted by those ids and the value
          range, 1000 per page.
        </p>
        <p>
          Genes and samples appear in the order they first show up in this ranking. A
          new query starts with 5 genes and 20 samples; scrolling loads more. Small
          matrices load every sample.
        </p>
      </HelpSection>

      <HelpSection title="3. Filling the grid">
        <p>
          The ranked page only holds the top cells, so the visible window is completed
          with extra <code>expression_values</code> requests by id list (cached). An
          empty cell has no stored value or falls outside the value range.
        </p>
      </HelpSection>

      <HelpSection title="Colours">
        <p>
          The scale is the matrix&apos;s own min–max value range (in its unit), so it is
          comparable within a matrix, not across matrices.
        </p>
      </HelpSection>
    </HelpPopover>
  )
}
