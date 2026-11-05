# RNAget Beacon demo

Demo Beacon v2 server and UI for the **matrix**, **genomic feature**, and **expression value** models added in this Beacon v2 tree. It implements those entry types against a Parquet data package of public RNA-seq quantification matrices, with biosamples as the linking sample axis.

Schemas live under [`beacon-v2/models/src/beacon-v2-default-model/`](../beacon-v2/models/src/beacon-v2-default-model/) (`matrices/`, `genomicFeatures/`, `expressionValues/`, plus the existing `biosamples/` model).

## What this is

The demo exposes Beacon envelopes for:

| Entry type | Schema id | Collection |
|---|---|---|
| `matrix` | `ga4gh-beacon-matrix-v2.1.2` | `/matrices` |
| `feature` (genomic feature) | `ga4gh-beacon-feature-v2.1.2` | `/features` |
| `expressionValue` | `ga4gh-beacon-expressionValues-v2.0.0` | nested only at `/matrices/{id}/expression_values` |
| `biosample` | `ga4gh-beacon-biosample-v2.0.0` | `/biosamples` (links to matrices only) |

`expressionValue` is not a root collection: cells are reached through a matrix.

→ [API](docs/api.md)

## Data

Example matrices are catalogued in [`scripts/profiles/datasets.yaml`](scripts/profiles/datasets.yaml), selected by source (`encode`, `geo`, `gtex`):

| Source | Matrices (current catalog) |
|---|---|
| **encode** | Guigo lab BLaER1 (`ENCSR622FSM`) and Gingeras lab GM12878 (`ENCSR000AED`); GENCODE v24 TPM |
| **geo** | `GSE164073`, `GSE152418` (TPM), `GSE107011` (raw counts), `GSE120795` (FPKM); NCBI Annotation Release 109.20190905 |
| **gtex** | GTEx v8 gene TPM for Adipose Subcutaneous, Liver, Whole Blood, Lung, Brain Cortex, and Skeletal Muscle; GENCODE v26 |

→ [Data package pipeline](docs/data-package.md)

## Building the data package

[`.github/workflows/build-data-package.yml`](.github/workflows/build-data-package.yml) is a **manual** workflow. It exports Parquet matrices, hydrates gene metadata from GTF/GFF, syncs feature types, enriches cross-references and GO slim terms, builds feature/biosample indexes, expression and tissue stats, filtering-term catalogs, then verifies the package and runs API tests. The result is uploaded as `data-package.tar.zst` (optional GitHub Release tag, default `data-latest`). Percentile tables are omitted from the release because of the 2 GiB asset limit.

→ [Data package pipeline](docs/data-package.md)

## Fetching the package locally

[`scripts/fetch_data_package.py`](scripts/fetch_data_package.py) downloads that release (`gh`, else HTTPS), extracts it, merges expression shards into per-matrix `expression.parquet`, reuses shipped stats unless `--force-stats`, always builds percentiles, then rebuilds filtering-term catalogs. Point the API at the result with `DATA_PACKAGE_PATH`.

```bash
python3 scripts/fetch_data_package.py --out /data/rnaget-demo --force
export DATA_PACKAGE_PATH=/data/rnaget-demo
```

→ [Data package pipeline](docs/data-package.md)

## Filtering terms

Catalogs ship as package-root `filtering_terms.json` and per-matrix files under `filtering_terms/by_matrix/`. They are built from ontology facets on features and biosamples plus expression stats during the GitHub Action, then rebuilt after fetch so percentile terms appear. Clients discover them at `GET /filtering_terms` and `GET|POST /matrices/{id}/filtering_terms`.

→ [Filtering terms](docs/filtering-terms.md)
