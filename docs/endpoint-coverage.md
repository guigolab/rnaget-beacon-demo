# Endpoint coverage

Paths for biosamples, features, matrices, and expression values. ✓ means the path exists or the UI calls it. ✗ means it does not.

`GET` and `POST` share a row when Beacon v2, the server, and the UI all agree. The UI sends `POST` when a query has a symbol, sex, unit, or other alphanumeric filter, or when it sends `requestParameters`. Otherwise it sends `GET`.

Filtering-term discovery uses root `GET|POST /filtering_terms` (client filters by `scopes`). Matrix-scoped catalogs are on `GET|POST /matrices/{id}/filtering_terms` (matrix workspace uses these; lenses still use root).

Demo extensions removed: `/matrices/{id}/heatmap` and `/matrices/{id}/features|biosamples/expression_summary`. Ranking and densify now use nested axis list endpoints plus `expression_values` with ID lists and optional expression filters / page tokens.

| Endpoint | Beacon v2 | Server | UI | Where the UI calls it |
|---|---|---|---|---|
| `GET`, `POST /filtering_terms` | ✓ | ✓ | ✓ | Features, biosamples, and matrices lenses; detail sheets |
| `GET`, `POST /biosamples` | ✓ | ✓ | ✓ | Biosamples lens |
| `GET /biosamples/{id}` | ✓ | ✓ | ✓ | Record sheet and biosample detail |
| `POST /biosamples/{id}` | ✓ | ✓ | ✗ | |
| `GET /biosamples/{id}/matrices` | ✓ | ✓ | ✓ | Biosample detail; biosample band grid (`expression.detectedGenesPercentile.*`) |
| `POST /biosamples/{id}/matrices` | ✓ | ✓ | ✓ | Biosample band grid (filters + `matrixIDList`) |
| `GET`, `POST /features` | ✓ | ✓ | ✓ | Features lens |
| `GET /features/{id}` | ✓ | ✓ | ✓ | Record sheet and feature detail |
| `POST /features/{id}` | ✓ | ✓ | ✗ | |
| `GET /features/{id}/matrices` | ✓ | ✓ | ✓ | Feature detail; matrices lens gene high-band; feature band grid |
| `POST /features/{id}/matrices` | ✓ | ✓ | ✓ | Feature band grid / gene→matrices with `expression.percentile.*` filters |
| `GET`, `POST /features/{id}/biosamples` | ✓ | ✗ | ✗ | |
| `GET`, `POST /matrices` | ✓ | ✓ | ✓ | Matrices lens |
| `GET /matrices/{id}` | ✓ | ✓ | ✓ | Matrix workspace |
| `POST /matrices/{id}` | ✓ | ✓ | ✗ | |
| `GET`, `POST /matrices/{id}/filtering_terms` | ✓ | ✓ | ✓ | Matrix workspace term browser |
| `GET`, `POST /matrices/{id}/biosamples` | ✓ | ✓ | ✓ | Matrix workspace and biosamples lens scoped to a matrix |
| `GET`, `POST /matrices/{id}/features` | ✓ | ✓ | ✓ | Matrix workspace and features lens scoped to a matrix |
| `GET`, `POST /matrices/{id}/expression_values` | ✓ | ✓ | ✓ | Heatmap densify (`featureIDList`×`biosampleIDList`); supports `expression.*` filters, `minValue`/`maxValue`, and `pagination.nextPage` tokens |

## Expression filters (notes)

- Feature-axis continuous terms on matrix paths: `expression.median` / `mean` / `max` / `detectedFraction` (alphanumeric with operator).
- Cell terms on `expression_values`: `expression.value`, `expression.percentileInFeature`, `expression.percentileInBiosample`.
- Categorical membership on `/features/{id}/matrices`: `expression.percentile.none|0-20|20-40|40-60|60-80|80-100` (and related `expression.profile:*`, `expression.detected:>=…`, `expression.enrichedIn:*`).
- Pagination: `expression_values` returns opaque `nextPage` / `previousPage` tokens when more rows remain; clients should prefer tokens over deep `skip`.
