RNAget extension for BeaconV2

## UI refactor (2026)

Progress and design notes: [UI-improvements.md](../UI-improvements.md) at the repo root.

- **API:** cohort `filters` on matrix biosamples/expression values, `expression_summary` endpoints, populated `/matrices/filtering_terms`, matrix catalog filters, extended biosample facets (GTEx + GEO enrichment in export scripts).
- **Front:** `front/` — gene/sample/dataset lenses, compare view, API drawer. Run `cd front && npm install && npm run dev`.