# RNAget Beacon demo

**Ask a Beacon which genes are switched on in which tissues.**

This project is a working demo of how [GA4GH Beacon v2](https://docs.genomebeacons.org/) can serve **RNA-seq expression data**, not just genomic variants. It adds three entry types to the Beacon model (**matrix**, **genomic feature**, **expression value**), links them to **biosamples**, and ships:

- a **Beacon v2 API** (FastAPI + DuckDB) that answers filter queries over real public data,
- an **Explorer web app** (Next.js) that shows the models in action, including a gene × tissue heatmap.

It is built for people who want to see what an expression-aware Beacon looks like, and for Beacon maintainers evaluating the proposed models.

## What can I do with it?

Real questions the demo answers, each as a plain Beacon request:

| Question | Beacon request | Granularity |
|---|---|---|
| Is **ALB** among the top 1% of genes in **liver**? | `POST /features` with `symbol = ALB` and `tissue.percentile:UBERON:0002107 >= 99` | `boolean` → yes / no |
| How many protein-coding genes are top 1% in liver? | the same endpoint with `feature.biotypeFamily = protein_coding` | `count` |
| Which matrices measure ALB? | `GET /features/{id}/matrices` | `record` |
| In how many GTEx liver samples is ALB expressed ≥ 1000 TPM? | `POST /matrices/GTEx-v8-Liver/expression_values` with `featureIDList` + `minValue` | `count` |
| What are the highest expression values in a matrix? | `expression_values` with `order = desc` | `record` |

The Explorer home page lists these (and more) as runnable cards with the exact request and `curl`.

## The data model in one picture

```text
biosample ──matrices──▶ matrix ◀──matrices── feature (genomic feature / gene)
                          │
                          └── expression_values ──▶ expressionValue   (one cell: gene × sample)
```

| Entry type | Schema | Where |
|---|---|---|
| `matrix`: a quantified expression table (units, assembly, annotation) | `ga4gh-beacon-matrix-v2.1.2` | `/matrices` |
| `feature`: a gene (symbol, cross-references, biotype, location) | `ga4gh-beacon-feature-v2.1.2` | `/features` |
| `biosample`: the sample axis (tissue, cell type) | `ga4gh-beacon-biosample-v2.0.0` | `/biosamples` |
| `expressionValue`: one measured cell | `ga4gh-beacon-expressionValues-v2.0.0` | `/matrices/{id}/expression_values` only |

`expressionValue` is not a root collection: values are always reached through a matrix. The schemas live in [`../beacon-v2/models/src/beacon-v2-default-model/`](../beacon-v2/models/src/beacon-v2-default-model/) (`matrices/`, `genomicFeatures/`, `expressionValues/`, `biosamples/`).

### Filters in two flavours

Beacon filters come in two types, and the demo uses exactly these:

- **Ontology** filters take only an id: `{"id": "UBERON:0002107"}` (liver), `{"id": "SO:0001217"}`, `{"id": "HGNC:11998"}`.
- **Alphanumeric** filters take `id` + `operator` + `value`: `{"id": "matrix.unit", "operator": "=", "value": "TPM"}` or `{"id": "symbol", "operator": "=", "value": "TP53"}`.

Every filter is combined with AND. [`GET /filtering_terms`](docs/filtering-terms.md) lists everything the beacon accepts.

## Quick start

You need Docker. The data package (a few GB of Parquet) is built separately, see [Data](#data).

```bash
# 1. get the data package (downloads the release, merges shards, builds stats)
DATA_PACKAGE_OUT=$PWD/data/rnaget-demo ./scripts/fetch_data_package_docker.sh

# 2. start the API and the web app
docker compose -f docker-compose-dev.yml up --build
```

| What | URL |
|---|---|
| Explorer (home, Explore, Matrices) | http://localhost:94/rnaget-beacon/ |
| Beacon API behind nginx | http://localhost:94/rnaget-beacon/api/ |
| API direct + Swagger UI | http://localhost:5000/docs |

Try the API:

```bash
curl -sS -X POST http://localhost:5000/features \
  -H 'Content-Type: application/json' \
  -d '{
    "meta": {"apiVersion": "v2.0.0"},
    "query": {
      "requestedGranularity": "boolean",
      "filters": [
        {"id": "symbol", "operator": "=", "value": "ALB"},
        {"id": "tissue.percentile:UBERON:0002107", "operator": ">=", "value": "99"}
      ]
    }
  }'
# → {"meta": {...}, "responseSummary": {"exists": true}}
```

### Run without Docker

```bash
# API (without DATA_PACKAGE_PATH it serves a tiny built-in JSON fixture)
cd server
pip install -r requirements.txt
DATA_PACKAGE_PATH=../data/rnaget-demo uvicorn app:app --port 5000

# Web app (Node 20.9+)
cd front
pnpm install        # or npm ci
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000 pnpm dev   # http://localhost:3000/rnaget-beacon/
```

The Explorer is a static Next.js export served by nginx under `/rnaget-beacon/`; `next dev` can also proxy `/rnaget-beacon/api/` to `http://127.0.0.1:5000` (override with `API_PROXY_TARGET`), so `NEXT_PUBLIC_API_BASE_URL` is optional in development.

## What's in the Explorer?

| Page | What it shows |
|---|---|
| **Home** | Catalog totals, the entry types and their filtering terms, and runnable query examples |
| **Explore** | Pick genes and/or tissues and see a gene × tissue heatmap. Cells are banded top 1% / present / not in any matrix, all derived from Beacon queries |
| **Matrices** | Browse matrices and open a workspace with an expression heatmap you can filter by value range and sort |

A floating **Show API call** drawer on every page displays the last Beacon request and its `curl`, so you can see exactly what the UI sent.

## Data

The demo serves **public** RNA-seq matrices from a Parquet data package: 12 matrices, about 100k genomic features and 3.6k biosamples.

| Source | Matrices | Annotation |
|---|---|---|
| **ENCODE** | `ENCSR622FSM` (BLaER1), `ENCSR000AED` (GM12878), TPM | GENCODE v24 |
| **GEO** | `GSE164073`, `GSE152418` (TPM), `GSE107011` (raw counts), `GSE120795` (FPKM) | NCBI Annotation Release 109.20190905 |
| **GTEx v8** | gene TPM for Adipose Subcutaneous, Liver, Whole Blood, Lung, Brain Cortex, Skeletal Muscle | GENCODE v26 |

The catalog is [`scripts/profiles/datasets.yaml`](scripts/profiles/datasets.yaml). A **manual GitHub Action** ([`build-data-package.yml`](.github/workflows/build-data-package.yml)) downloads the matrices, hydrates gene metadata, builds the indexes, stats and filtering-term catalogs, verifies the result and publishes `data-package.tar.zst`. The fetch script then prepares it for the API. Full pipeline: [docs/data-package.md](docs/data-package.md).

## Repository map

```text
server/      FastAPI Beacon API, DuckDB/Parquet store, tests (pytest)
front/       Next.js Explorer (static export served by nginx)
scripts/     data pipeline: export, hydrate, stats, filtering terms, fetch
data/        local data package (git-ignored)
nginx/       reverse proxy for the UI and the API
docs/        guides (see below)
rnaget-beacon-schema.yaml   committed OpenAPI, regenerated with scripts/export_openapi.py
```

Run the API tests with `cd server && pytest`.

## Documentation

Start at the [docs index](docs/README.md). Short version:

| I want to… | Read |
|---|---|
| understand the endpoints and request/response shapes | [docs/api.md](docs/api.md), [docs/endpoint-coverage.md](docs/endpoint-coverage.md) |
| know which filters exist and how they are advertised | [docs/filtering-terms.md](docs/filtering-terms.md) |
| understand how the data is built | [docs/data-package.md](docs/data-package.md), [docs/data-package-gha.md](docs/data-package-gha.md) |
| browse the OpenAPI without running a server | open [`index.html`](index.html) over HTTP (`python3 -m http.server 8080`) |

## Status

This is a **demo of proposed Beacon v2 models**, not a production service. The matrix, genomic feature and expression value schemas are part of the Beacon v2 tree in this workspace and are meant for discussion. A few RNAget extensions go beyond the Beacon spec (`featureIDList`, `biosampleIDList`, `minValue`, `maxValue`, `order` and `pageToken` on `expression_values`); they are listed in [docs/endpoint-coverage.md](docs/endpoint-coverage.md).

## License

MIT. See [LICENSE](LICENSE).
