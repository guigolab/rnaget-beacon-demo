RNAget extension for BeaconV2

## UI refactor (2026)

Progress and design notes: [UI-improvements.md](../UI-improvements.md) at the repo root.

- **API:** cohort `filters` on matrix biosamples/expression values (including `expression.*` band/profile/stats terms), root `/filtering_terms` plus `/matrices/{id}/filtering_terms`, keyset page tokens on `expression_values`, matrix catalog filters, extended biosample facets (GTEx + GEO enrichment in export scripts). Axis extrema for the matrix workspace use nested `expression_values` (no non-Beacon `info.expressionSummary` embed).
- **Front:** `front/` — gene/sample/dataset lenses, compare view, API drawer. Run `cd front && npm install && npm run dev`.