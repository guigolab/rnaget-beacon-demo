# Beacon API contract

The RNA-Get demo exposes a **Beacon v2–style** HTTP API (resultSets envelopes, informational endpoints, RNA entry types).

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

Entity payload shapes are mirrored from [`beacon-schemas/`](../beacon-schemas/) into OpenAPI `components.schemas` (`Matrix`, `GenomicFeatureWrapper`, `Biosample`, `ExpressionValue`, …).

## Data backend

- Default: small JSON fixtures under `server/beacon/fixtures/data/`
- Production-style: set `DATA_PACKAGE_PATH` to a merged Parquet package (see [data-package-gha.md](data-package-gha.md))

## Entity field coverage (package-backed)

Filled from export/hydrate when data exists; clinical biosample fields and gene `relationship` are **not** fabricated.

| Entity | Notable fields |
|---|---|
| **Matrix** | Required Beacon fields from profiles + `expressionValueRange` (stats) + `annotation.md5Checksum` (hydrate of GTF/GFF) |
| **genomicFeature** | `featureType` / `ontologyTerms` / `xrefs` / `aliases`; `genomicInterval` as VRS `SequenceLocation` (`refseq:NC_…` via GRCh38 contig map, GFF 1-based → 0-based interbase). Unmapped contigs omit the interval. No `relationship` on gene matrices |
| **Biosample** | `biosampleStatus`, `sampleOriginType`, `sampleOriginDetail`, optional `sampleProcessing`, `collectionDate`, `phenotypicFeatures`, GTEx RIN in `measurements[]` (`NCIT:C63637`); `individualId` ← donor; sex and experimental offsets in `info` |

## Filtering terms and `query.filters`

Informational catalogs:

- `GET|POST /filtering_terms` — all scopes
- `GET|POST /features/filtering_terms` — `genomicFeature` facets
- `GET|POST /biosamples/filtering_terms` — `biosample` facets
- `GET|POST /matrices/{id}/features/filtering_terms` — facets observed on features in that matrix
- `GET|POST /matrices/{id}/biosamples/filtering_terms` — facets observed on biosamples in that matrix

The package ships `filtering_terms.json` (SO/GO feature facets; UBERON/EFO/OBI/MONDO/HP/NCIT biosample facets; matrix assay facets; alphanumeric field ids; `resources[]` including `hgnc` / `ncbigene` / `ensembl` / `go` / `mondo` when used). Individual HGNC/NCBIGene values are **not** listed.

Apply filters on list endpoints (`GET|POST /features`, `GET|POST /biosamples`):

| Filter | Example | Behavior |
|---|---|---|
| Ontology SO | `{"id":"SO:0001217"}` | Match `featureType` **or** `ontologyTerms` (via `feature_ontology` index when present; payloads still include nested `ontologyTerms`) |
| Ontology biosample | `{"id":"UBERON:0002107"}` | Match `sampleOriginDetail`, `biosampleStatus`, `sampleOriginType`, `sampleProcessing`, phenotype, or measurement assay id |
| Ontology GO (features) | `{"id":"GO:0008150"}` | Match `featureType` or `ontologyTerms` |
| Gene public id | `{"id":"HGNC:11998"}` | Resolve via `gene_lookup` / xrefs; miss → empty page |
| Symbol | `{"id":"genomicFeature.symbol","operator":"=","value":"TP53"}` | Lookup; miss → empty page |
| Unknown prefix / field | — | HTTP 400 |

POST body: `{"query":{"filters":[…],"pagination":{"skip":0,"limit":10}}}`. GET ontology filters: `?filters=SO:0000704,HGNC:11998`. Alphanumeric filters need an operator, so GET uses `field:op:value` (for example `sex:=:female` or `rin:>=:7`). POST remains the general form.

## Request behavior

- `skip` is an **item** offset. Beacon's text says "pages"; this server keeps the usual item offset and does not return `currentPage` / `nextPage` tokens.
- `limit=0` means "as many as the server allows" and is applied as 1000, which is also the maximum page size. The applied limit is echoed in `receivedRequestSummary.pagination`.
- Expression value queries reject `skip` above 100000. Feature, biosample, and matrix listings do not use that cap.
- `query.includeResultsetResponses` accepts `ALL`, `HIT`, `MISS`, or `NONE` (Beacon v2). It is echoed in `receivedRequestSummary`. `NONE` omits result sets; `HIT` includes the result set only when it exists; `MISS` includes it only when it does not.
- Ontology filters match the term id exactly. `includeDescendantTerms` is not applied (the package has no ontology closure). Responses echo `includeDescendantTerms: false` and `similarity: "exact"`.
- `GET /matrices/{id}/expression_summary` requires `featureIDList`. A summary over every gene in a matrix is not computed.
- `biosampleStatus` is `EFO:0009654` (`reference sample`) when the source does not classify the sample. That includes GTEx post-mortem tissue.
- `GET /service-info` returns a GA4GH Service Info document (no Beacon `meta` / `response` envelope).
- `receivedRequestSummary.apiVersion` uses the same value as `meta.apiVersion` (including the `v` prefix).
- Contig accessions for `genomicInterval` come from `server/beacon/data/grch38_contig_to_refseq.json`, which is copied into the API image.
