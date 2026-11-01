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

## Filtering terms and `query.filters`

Informational catalogs:

- `GET|POST /filtering_terms` — all scopes
- `GET|POST /features/filtering_terms` — `genomicFeature` facets
- `GET|POST /biosamples/filtering_terms` — `biosample` facets

The package ships a small `filtering_terms.json` (DISTINCT SO / UBERON / EFO facets, alphanumeric field ids, `resources[]` including `hgnc` / `ncbigene` / `ensembl`). Individual HGNC/NCBIGene values are **not** listed.

Apply filters on list endpoints (`GET|POST /features`, `GET|POST /biosamples`):

| Filter | Example | Behavior |
|---|---|---|
| Ontology SO | `{"id":"SO:0001217"}` | Match `featureType` **or** `ontologyTerms` |
| Ontology biosample | `{"id":"UBERON:0002107"}` | Match sample ontology id |
| Gene public id | `{"id":"HGNC:11998"}` | Resolve via `gene_lookup` / xrefs; miss → empty page |
| Symbol | `{"id":"genomicFeature.symbol","operator":"=","value":"TP53"}` | Lookup; miss → empty page |
| Unknown prefix / field | — | HTTP 400 |

POST body: `{"query":{"filters":[…],"pagination":{"skip":0,"limit":10}}}`. GET: `?filters=SO:0000704,HGNC:11998`.
