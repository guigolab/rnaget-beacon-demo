# Endpoint coverage

Every path the server exposes, whether the Explorer UI calls it, and where. The server column is generated from the routers in [`server/routers/`](../server/routers/) and matches the committed OpenAPI, [`rnaget-beacon-schema.yaml`](../rnaget-beacon-schema.yaml) (regenerate with `python3 scripts/export_openapi.py`).

Legend: ✓ the path exists or the UI calls it, ✗ it does not.

## How requests are sent

- **GET vs POST.** The UI sends `GET` when it can and `POST` when a query has an alphanumeric filter (symbol, unit, source, percentile…) or `requestParameters`. Ontology-only filters stay on `GET` as `?filters=ID1,ID2`.
- **POST body.** `meta.apiVersion` is required. Unknown top-level fields are rejected, and so are the slice fields `featureIDList`, `biosampleIDList`, `minValue`, `maxValue` and `order` at the top level: they belong under `query.requestParameters.expressionValue`.
- **Filters** are accepted on the three collection roots only (`/features`, `/biosamples`, `/matrices`). The nested relation routes reject `query.filters`.
- **Request parameters** exist for one entry type: `expressionValue`. Any other key under `requestParameters` is a 400.
- **Granularity.** Every listing honours `requestedGranularity` (`boolean`, `count`, `record`).
- **Filtering-term discovery** is the root `GET /filtering_terms` only; the client filters by `scopes`. Nested `/{entry}/{id}/filtering_terms` routes do not exist.

## Informational endpoints

| Endpoint | Server | UI | Where the UI calls it |
|---|---|---|---|
| `GET /`, `GET /info` | ✓ | ✓ (`/info`) | Home page header |
| `GET /service-info` | ✓ | ✗ | |
| `GET /configuration` | ✓ | ✗ | |
| `GET /map` | ✓ | ✓ | Home page, endpoint map |
| `GET /entry_types` | ✓ | ✓ | Home page, entry-type cards |
| `GET /filtering_terms` | ✓ | ✓ | Features, biosamples and matrices lenses; Explore; home page |

## Entry-type endpoints

| Endpoint | Server | UI | Where the UI calls it |
|---|---|---|---|
| `GET`, `POST /biosamples` | ✓ | ✓ | Biosamples lens |
| `GET /biosamples/{id}` | ✓ | ✓ | Record sheet, biosample detail |
| `POST /biosamples/{id}` | ✓ | ✗ | |
| `GET /biosamples/{id}/matrices` | ✓ | ✓ | Biosample detail |
| `POST /biosamples/{id}/matrices` | ✓ (no filters, no request parameters) | ✗ | |
| `GET`, `POST /features` | ✓ | ✓ | Features lens, Explore bands, home examples |
| `GET /features/{id}` | ✓ | ✓ | Record sheet, feature detail |
| `POST /features/{id}` | ✓ | ✗ | |
| `GET /features/{id}/matrices` | ✓ | ✓ | Feature detail, matrix lookups |
| `POST /features/{id}/matrices` | ✓ (no filters, no request parameters) | ✗ | |
| `GET`, `POST /features/{id}/biosamples` | ✗ (outside the RNAget scope) | ✗ | |
| `GET`, `POST /matrices` | ✓ | ✓ | Matrices lens, home examples |
| `GET /matrices/{id}` | ✓ | ✓ | Matrix workspace |
| `POST /matrices/{id}` | ✓ | ✗ | |
| `GET /matrices/{id}/features` | ✓ | ✓ | Matrix workspace, features lens scoped to a matrix |
| `POST /matrices/{id}/features` | ✓ (no filters, no request parameters) | ✗ | |
| `GET /matrices/{id}/biosamples` | ✓ | ✓ | Matrix workspace, biosamples lens scoped to a matrix |
| `POST /matrices/{id}/biosamples` | ✓ (no filters, no request parameters) | ✗ | |
| `GET`, `POST /matrices/{id}/expression_values` | ✓ | ✓ | Heatmap cell fetch and ranked slice (`POST` when it sends `requestParameters`); Explore cell popovers; home examples |

`expressionValue` is not a root collection: it is reached only through `/matrices/{id}/expression_values`.

## RNAget extensions

Beyond Beacon v2, only on `expression_values` (server and UI):

| Parameter | Where | Meaning |
|---|---|---|
| `featureIDList`, `biosampleIDList` | `query.requestParameters.expressionValue` (POST) or query string (GET) | comma-separated ids restricting the cells (up to 200 tokens) |
| `minValue`, `maxValue` | same | value range; `minValue` greater than `maxValue` is a 400 |
| `order` | same | `asc` or `desc` (default `desc`); results are always ordered by value, and `sort` is rejected |
| `pageToken` | GET query string, or `query.pagination.nextPage` / `previousPage` on POST | opaque keyset token; prefer it to deep `skip` (`skip` is capped at 100000 for this endpoint) |

`GET` collection roots also accept `filters` as a comma-separated list of filter ids.

Removed demo extensions: `/matrices/{id}/heatmap`, `/matrices/{id}/{features|biosamples}/expression_summary`, root `POST /filtering_terms`, nested `filtering_terms` routes, and the response-envelope `info.axes` on `expression_values`. Ranking and densify resolve filters at the collection roots, then use the nested axis listings plus `expression_values` with id lists, value range and page tokens.

## Expression filters (notes)

- Feature-axis continuous terms on matrix paths: `expression.median` / `mean` / `max` (alphanumeric with operator; matrix-only, rejected at the `/features` root).
- Feature-axis `expression.percentile` (catalog type **alphanumeric**; allowed at the root via a union over per-matrix median percentiles; UI chips 90/95/99).
- `tissue.percentile:{ontologyId}` on `/features`: `>= 99` is the top 1% in that tissue, `>= 0` is detected in it.
- Cell terms on `expression_values`: `expression.value`, `expression.percentileInFeature`, `expression.percentileInBiosample`.
- Pagination: `expression_values` returns opaque `nextPage` / `previousPage` tokens when more rows remain.
