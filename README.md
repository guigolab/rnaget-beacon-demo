RNAget extension for BeaconV2

## UI refactor (2026)

Progress and design notes: [UI-improvements.md](../UI-improvements.md) at the repo root.

- **API:** cohort `filters` on matrix biosamples/expression values (including `expression.*` band/profile/stats terms), root `/filtering_terms` plus `/matrices/{id}/filtering_terms`, keyset page tokens on `expression_values`, matrix catalog filters, extended biosample facets (GTEx + GEO enrichment in export scripts). Embedded per-axis min/max live on feature/biosample `info.expressionSummary` from stats parquet (not a separate summary endpoint).
- **Front:** `front/` — gene/sample/dataset lenses, compare view, API drawer. Run `cd front && npm install && npm run dev`.