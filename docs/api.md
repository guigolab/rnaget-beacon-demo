# Beacon API contract

The RNA-Get demo exposes a **Beacon v2–style** HTTP API (resultSets envelopes, informational endpoints, RNA entry types) for the **matrix**, **genomic feature**, and **expression value** models in this Beacon v2 tree, with **biosamples** as the sample axis.

Schemas live under [`beacon-v2/models/src/beacon-v2-default-model/`](../../beacon-v2/models/src/beacon-v2-default-model/) (`matrices/`, `genomicFeatures/`, `expressionValues/`, `biosamples/`). Filtering catalogs: [filtering-terms.md](filtering-terms.md). Data backend: [data-package.md](data-package.md).

## Entry types and relationships

```text
biosample ──matrices──▶ matrix
feature   ──matrices──▶ matrix
matrix    ──biosamples──▶ biosample
matrix    ──features──▶ feature
matrix    ──expression_values──▶ expressionValue   (not a root collection)
matrix    ──filtering_terms──▶ filtering terms (matrix-scoped)
ROOT      ──filtering_terms──▶ filtering terms (all scopes)
```

| Entry type id | Schema id | Collection |
|---|---|---|
| `biosample` | `ga4gh-beacon-biosample-v2.0.0` | `/biosamples` |
| `feature` | `ga4gh-beacon-feature-v2.1.2` | `/features` |
| `matrix` | `ga4gh-beacon-matrix-v2.1.2` | `/matrices` |
| `expressionValue` | `ga4gh-beacon-expressionValues-v2.0.0` | nested under `/matrices/{id}/expression_values` only |

`expressionValue` is **not** a root entry-type collection. Units and scale come from the parent matrix `expressionUnitAndScale`.

### ID rules

- Beacon feature record `id` is not necessarily the matrix row accession.
- `expressionValue.featureId` must equal `featureIdentifier.id` (native accession, e.g. `ENSG…`), not a CURIE and not necessarily `features.id`.
- Biosample cross-links in this RNAget flavour are only to matrices (`/biosamples/{id}/matrices`).

## Live docs (running API)

With the server running (direct, port 5000):

- Interactive Swagger UI: `/docs`
- ReDoc: `/redoc`
- Machine-readable OpenAPI: `/openapi.json`

Via nginx (subpath), the same routes are under `/rnaget-beacon/api/` (e.g. `/rnaget-beacon/api/docs`). The static Explorer UI is at `/rnaget-beacon/`.

## Static Swagger UI (committed schema)

Repo root [`index.html`](../index.html) + [`dist/`](../dist/) host a standalone Swagger UI that loads [`rnaget-beacon-schema.yaml`](../rnaget-beacon-schema.yaml) (no server required). Serve the repo root over HTTP, for example:

```bash
cd rnaget-beacon-demo
python3 -m http.server 8080
# open http://localhost:8080/
```

## Committed OpenAPI YAML

[`rnaget-beacon-schema.yaml`](../rnaget-beacon-schema.yaml) is generated from the FastAPI app so offline clients and the static Swagger UI stay aligned with the code.

Regenerate after router or envelope changes:

```bash
pip install -r server/requirements.txt
python3 scripts/export_openapi.py
```

Entity payload shapes are mirrored from [`beacon-schemas/`](../beacon-schemas/) into OpenAPI `components.schemas` (`Matrix`, `GenomicFeature`, `Biosample`, `ExpressionValue`, …).

## Data backend

- Default: small JSON fixtures under `server/beacon/fixtures/data/`
- Production-style: set `DATA_PACKAGE_PATH` to a merged Parquet package (see [data-package.md](data-package.md))

## Entity field coverage (package-backed)

Filled from export/hydrate when data exists; clinical biosample fields and gene `relationship` are **not** fabricated.

| Entity | Notable fields |
|---|---|
| **Matrix** | Required Beacon fields from profiles + `expressionValueRange` (stats) + `annotation.md5Checksum` (hydrate of GTF/GFF) |
| **genomicFeature** | `featureType` / `ontologyTerms` / `xrefs` / `aliases`; `genomicInterval` as VRS `SequenceLocation` (`refseq:NC_…` via GRCh38 contig map, GFF 1-based → 0-based interbase). Unmapped contigs omit the interval. No `relationship` on gene matrices |
| **Biosample** | `biosampleStatus`, `sampleOriginType`, `sampleOriginDetail`, optional `sampleProcessing`, `collectionDate`, `phenotypicFeatures`, GTEx RIN in `measurements[]` (`NCIT:C63637`); `individualId` ← donor; sex and experimental offsets in `info` |

## Filtering terms and `query.filters`

Overview of advertised terms and how catalogs are built:
[filtering-terms.md](filtering-terms.md). Catalog of **custom** filter ids
(expression customs, biotype families), how stats bands are computed, and
friendlier labels: [custom-filtering-terms.md](custom-filtering-terms.md).

Informational catalogs:

- `GET /filtering_terms` — all scopes (`genomicFeature`, `biosample`, `matrix`); clients filter by `scopes` (GET only; optional `skip`/`limit`)
- `GET|POST /matrices/{id}/filtering_terms` — terms observed on that matrix’s features and biosamples (both scopes)

Dropped: `/features/filtering_terms`, `/biosamples/filtering_terms`, `/matrices/filtering_terms`, and `/matrices/{id}/{features|biosamples}/filtering_terms`.

Catalogs are built by `scripts/fetch_data_package.py` (root `filtering_terms.json` plus `filtering_terms/by_matrix/{matrixId}.json`). They include SO/GO feature facets; UBERON/EFO/OBI/MONDO/HP/NCIT biosample facets; matrix assay facets; alphanumeric field ids; and `resources[]` for namespaces in use (`so`, `go`, `uberon`, `efo`, `obi`, `mondo`, `hp`, `ncit`, `hgnc`, `ncbigene`, `ensembl`, `symbol`). Individual HGNC/NCBIGene/ENSEMBL values and gene symbols are **not** listed as terms.

Apply filters on list endpoints (`GET|POST /features`, `GET|POST /biosamples`):

| Filter | Example | Behavior |
|---|---|---|
| Ontology SO | `{"id":"SO:0001217"}` | Match `featureType` **or** `ontologyTerms` (via `feature_ontology` index when present; payloads still include nested `ontologyTerms`) |
| Ontology biosample | `{"id":"UBERON:0002107"}` | Match `sampleOriginDetail`, `biosampleStatus`, `sampleOriginType`, `sampleProcessing`, phenotype, or measurement assay id |
| Ontology GO (features) | `{"id":"GO:0008150"}` | Match `featureType` or `ontologyTerms` |
| Gene public id | `{"id":"HGNC:11998"}` | Resolve via `gene_lookup` / xrefs; miss → empty page |
| Symbol (custom) | `{"id":"symbol:TP53"}` | Lookup via aliases / `gene_lookup`; miss → empty page |
| Unknown prefix / field | — | HTTP 400 |

POST body: `{"query":{"filters":[…],"pagination":{"skip":0,"limit":10}}}`. GET ontology filters: `?filters=SO:0000704,HGNC:11998`. Alphanumeric filters need an operator, so GET uses `field:op:value` (for example `sex:=:female` or `rin:>=:7`). POST remains the general form.

## Request behavior

- `skip` is an **item** offset for most list endpoints. For `expression_values`, the server also returns opaque `pagination.nextPage` / `previousPage` tokens (Beacon PageToken); prefer those over deep `skip` when present. Pass the token as `pageToken` (GET) or `query.pagination.nextPage` / `previousPage` (POST).
- `limit=0` means "as many as the server allows" and is applied as 1000, which is also the maximum page size. The applied limit is echoed in `receivedRequestSummary.pagination`.
- Expression value queries reject `skip` above 100000. Feature, biosample, and matrix listings do not use that cap.
- `query.includeResultsetResponses` accepts `ALL`, `HIT`, `MISS`, or `NONE` (Beacon v2). It is echoed in `receivedRequestSummary`. `NONE` omits result sets; `HIT` includes the result set only when it exists; `MISS` includes it only when it does not.
- Ontology filters match the term id exactly. `includeDescendantTerms` is not applied (the package has no ontology closure). Responses echo `includeDescendantTerms: false` and `similarity: "exact"`.
- Nested `/matrices/{id}/features` accepts filters plus optional `featureIDList` only; `/matrices/{id}/biosamples` accepts filters plus optional `biosampleIDList` only (no `sort`/`order`/cross ID lists/value bounds). Cell retrieval is `/matrices/{id}/expression_values` (optional `featureIDList` / `biosampleIDList`, `minValue` / `maxValue`, `order` by cell value, and cell-scoped `expression.value` / percentile filters). There is no separate heatmap or expression_summary route.
- `/features/{id}/matrices` accepts alphanumeric `expression.percentile` (e.g. `>=` / `90`) and optional `matrixIDList`.
- `biosampleStatus` is `EFO:0009654` (`reference sample`) when the source does not classify the sample. That includes GTEx post-mortem tissue.
- `GET /service-info` returns a GA4GH Service Info document (no Beacon `meta` / `response` envelope).
- `receivedRequestSummary.apiVersion` uses the same value as `meta.apiVersion` (including the `v` prefix).
- Contig accessions for `genomicInterval` come from `server/beacon/data/grch38_contig_to_refseq.json`, which is copied into the API image.
