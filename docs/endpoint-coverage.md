# Endpoint coverage

Paths for biosamples, features, matrices, and expression values. ✓ means the path exists or the UI calls it. ✗ means it does not.

`GET` and `POST` share a row when Beacon v2, the server, and the UI all agree. The UI sends `POST` when a query has a symbol, sex, unit, or other alphanumeric filter, or when it sends `requestParameters`. Otherwise it sends `GET`. POST bodies always include required `meta.apiVersion`.

Filtering-term discovery uses root `GET /filtering_terms` only (client filters by `scopes`). Nested `/matrices/{id}/filtering_terms` is removed.

Normative OpenAPI: [`rnaget-beacon-schema.yaml`](../rnaget-beacon-schema.yaml) (from `scripts/export_openapi.py`).

Demo extensions removed: `/matrices/{id}/heatmap`, `/matrices/{id}/features|biosamples/expression_summary`, root `POST /filtering_terms`, and response-envelope `info.axes` on `expression_values`. Ranking and densify resolve filters at collection roots, then use nested axis list endpoints plus `expression_values` with ID lists / `minValue`/`maxValue` / page tokens (no nested `filters`).

RNAget extensions (Server ✓): `featureIDList` / `biosampleIDList` / `minValue` / `maxValue` / `order` (default `desc`) / `pageToken` on `expression_values` only; GET `filters` as CSV on collection roots only.

| Endpoint | Beacon v2 | Server | UI | Where the UI calls it |
|---|---|---|---|---|
| `GET /filtering_terms` | ✓ | ✓ | ✓ | Features, biosamples, and matrices lenses; detail sheets |
| `GET`, `POST /biosamples` | ✓ | ✓ | ✓ | Biosamples lens |
| `GET /biosamples/{id}` | ✓ | ✓ | ✓ | Record sheet and biosample detail |
| `POST /biosamples/{id}` | ✓ | ✓ | ✗ | |
| `GET /biosamples/{id}/matrices` | ✓ | ✓ | ✓ | Biosample detail; matrices linked to a biosample |
| `POST /biosamples/{id}/matrices` | ✓ | ✓ | ✓ | Matrices for a biosample (no filters, no request parameters; UI still sends `matrixIDList`, which the server now rejects — front-end update pending) |
| `GET`, `POST /features` | ✓ | ✓ | ✓ | Features lens; Explore band probes (UI still sends `featureIDList`, which the server no longer accepts — front-end update pending) |
| `GET /features/{id}` | ✓ | ✓ | ✓ | Record sheet and feature detail |
| `POST /features/{id}` | ✓ | ✓ | ✗ | |
| `GET /features/{id}/matrices` | ✓ | ✓ | ✓ | Feature detail; matrices lens gene top-percentile; feature band grid |
| `POST /features/{id}/matrices` | ✓ | ✓ | ✓ | Feature band grid / gene→matrices with alphanumeric `expression.percentile` |
| `GET`, `POST /features/{id}/biosamples` | ✓ (full Beacon) | ✗ (out of RNAget scope) | ✗ | |
| `GET`, `POST /matrices` | ✓ | ✓ | ✓ | Matrices lens |
| `GET /matrices/{id}` | ✓ | ✓ | ✓ | Matrix workspace |
| `POST /matrices/{id}` | ✓ | ✓ | ✗ | |
| `GET`, `POST /matrices/{id}/biosamples` | ✓ | ✓ | ✓ | Matrix workspace and biosamples lens scoped to a matrix |
| `GET`, `POST /matrices/{id}/features` | ✓ | ✓ | ✓ | Matrix workspace and features lens scoped to a matrix |
| `GET`, `POST /matrices/{id}/expression_values` | ✓ | ✓ | ✓ | Heatmap densify (`featureIDList`×`biosampleIDList`); supports `minValue`/`maxValue`, `order`, and `pagination.nextPage` tokens (no nested filters) |

## Expression filters (notes)

- Feature-axis continuous terms on matrix paths: `expression.median` / `mean` / `max` (alphanumeric with operator; matrix-only).
- Feature-axis `expression.percentile` (catalog type **alphanumeric**; **root-allowed** via UNION over matrix `median_percentile`; demo chips 90/95/99).
- Cell terms on `expression_values`: `expression.value`, `expression.percentileInFeature`, `expression.percentileInBiosample`.
- Pagination: `expression_values` returns opaque `nextPage` / `previousPage` tokens when more rows remain; clients should prefer tokens over deep `skip`.
