# Endpoint coverage

Paths for biosamples, features, matrices, and expression values. ✓ means the path exists or the UI calls it. ✗ means it does not.

`GET` and `POST` share a row when Beacon v2, the server, and the UI all agree. The UI sends `POST` when a query has a symbol, sex, unit, or other alphanumeric filter, or when it sends `requestParameters`. Otherwise it sends `GET`.

Filtering-term discovery uses root `GET /filtering_terms` (client filters by `scopes`). Matrix-scoped catalogs are on `GET|POST /matrices/{id}/filtering_terms` (matrix workspace uses these; lenses still use root).

Normative OpenAPI: [`rnaget-beacon-schema.yaml`](../rnaget-beacon-schema.yaml) (from `scripts/export_openapi.py`).

Demo extensions removed: `/matrices/{id}/heatmap`, `/matrices/{id}/features|biosamples/expression_summary`, root `POST /filtering_terms`, and response-envelope `info.axes` on `expression_values`. Ranking and densify use nested axis list endpoints plus `expression_values` with ID lists and optional expression filters / page tokens.

Official RNAget extensions (Server ✓): `matrixIDList`; nested `featureIDList` / `biosampleIDList` (matching path only); expression_values `order` by value + `pageToken`; GET `filters` as CSV.

| Endpoint | Beacon v2 | Server | UI | Where the UI calls it |
|---|---|---|---|---|
| `GET /filtering_terms` | ✓ | ✓ | ✓ | Features, biosamples, and matrices lenses; detail sheets |
| `GET`, `POST /biosamples` | ✓ | ✓ | ✓ | Biosamples lens |
| `GET /biosamples/{id}` | ✓ | ✓ | ✓ | Record sheet and biosample detail |
| `POST /biosamples/{id}` | ✓ | ✓ | ✗ | |
| `GET /biosamples/{id}/matrices` | ✓ | ✓ | ✓ | Biosample detail; matrices linked to a biosample |
| `POST /biosamples/{id}/matrices` | ✓ | ✓ | ✓ | Matrices for a biosample (optional filters + `matrixIDList`) |
| `GET`, `POST /features` | ✓ | ✓ | ✓ | Features lens; Explore band probes via `featureIDList` + `tissueTop`/`tissuePresent` (≥99/&lt;99/none) |
| `GET /features/{id}` | ✓ | ✓ | ✓ | Record sheet and feature detail |
| `POST /features/{id}` | ✓ | ✓ | ✗ | |
| `GET /features/{id}/matrices` | ✓ | ✓ | ✓ | Feature detail; matrices lens gene top-percentile; feature band grid |
| `POST /features/{id}/matrices` | ✓ | ✓ | ✓ | Feature band grid / gene→matrices with alphanumeric `expression.percentile` |
| `GET`, `POST /features/{id}/biosamples` | ✓ (full Beacon) | ✗ (out of RNAget scope) | ✗ | |
| `GET`, `POST /matrices` | ✓ | ✓ | ✓ | Matrices lens |
| `GET /matrices/{id}` | ✓ | ✓ | ✓ | Matrix workspace |
| `POST /matrices/{id}` | ✓ | ✓ | ✗ | |
| `GET`, `POST /matrices/{id}/filtering_terms` | ✓ | ✓ | ✓ | Matrix workspace term browser |
| `GET`, `POST /matrices/{id}/biosamples` | ✓ | ✓ | ✓ | Matrix workspace and biosamples lens scoped to a matrix |
| `GET`, `POST /matrices/{id}/features` | ✓ | ✓ | ✓ | Matrix workspace and features lens scoped to a matrix |
| `GET`, `POST /matrices/{id}/expression_values` | ✓ | ✓ | ✓ | Heatmap densify (`featureIDList`×`biosampleIDList`); supports `expression.*` filters, `minValue`/`maxValue`, and `pagination.nextPage` tokens |

## Expression filters (notes)

- Feature-axis continuous terms on matrix paths: `expression.median` / `mean` / `max` (alphanumeric with operator; matrix-only).
- Feature-axis `expression.percentile` (catalog type **custom**; request alphanumeric; **root-allowed** via UNION over matrix `median_percentile`; demo chips 90/95/99).
- Cell terms on `expression_values`: `expression.value`, `expression.percentileInFeature`, `expression.percentileInBiosample`.
- Pagination: `expression_values` returns opaque `nextPage` / `previousPage` tokens when more rows remain; clients should prefer tokens over deep `skip`.
