# Data package

This demo serves expression matrices from a **Parquet data package** rather than inventing records at query time. The package is built on GitHub Actions, published as a release asset, and prepared locally by a fetch script before the API starts.

| Piece | Path |
|---|---|
| Workflow | [`.github/workflows/build-data-package.yml`](../.github/workflows/build-data-package.yml) |
| Fetch | [`scripts/fetch_data_package.py`](../scripts/fetch_data_package.py) |
| Catalog | [`scripts/profiles/datasets.yaml`](../scripts/profiles/datasets.yaml) |

Operator troubleshooting and publish-without-rebuild notes: [data-package-gha.md](data-package-gha.md).

## What datasets are included

Each catalog record has a **source** (`encode`, `geo`, or `gtex`) that selects the parser. Workflow / CLI `--profiles` is a comma-separated list of sources; every matching matrix is built.

| Source | Matrices (current catalog) | Annotation |
|---|---|---|
| **encode** | `ENCSR622FSM` (Guigo lab BLaER1), `ENCSR000AED` (Gingeras lab GM12878) | GENCODE v24 TPM |
| **geo** | `GSE164073`, `GSE152418` (TPM), `GSE107011` (raw counts), `GSE120795` (FPKM) | NCBI Annotation Release 109.20190905 |
| **gtex** | Adipose Subcutaneous, Liver, Whole Blood, Lung, Brain Cortex, Skeletal Muscle (GTEx v8 gene TPM) | GENCODE v26 |

Each record points at a public download URL and pins the genome annotation (GTF/GFF) used to define gene IDs. That annotation is reused when hydrating symbols and coordinates.

## Build workflow (GitHub Actions)

The workflow is started **manually** (Actions → **Build Parquet data package** → Run workflow). It does not run on every push.

### Inputs

| Input | Meaning |
|---|---|
| **profiles** | Catalog sources to build, comma-separated (default: `encode,geo,gtex`) |
| **max_genes** / **max_samples** | Optional caps so only a slice of each matrix is imported |
| **smoke** | If enabled and caps are empty, uses 500 genes × 20 samples for a fast end-to-end check |
| **create_release** | If enabled, attaches the archive to a GitHub Release |
| **release_tag** | Release tag when publishing (default `data-latest`) |

A full GTEx-inclusive build can take a long time (job timeout up to six hours). Smoke mode validates the pipeline in minutes.

### Pipeline steps

```text
Checkout → Disk check → Python + download cache
  → export_parquet.py
  → hydrate_genes.py
  → sync_matrix_feature_types.py
  → enrich_gene_annotations.py
  → build_feature_indexes.py
  → build_expression_stats.py
  → build_tissue_expression_stats.py
  → build_tissue_feature_summary.py
  → build_matrix_filtering_terms.py --with-root
  → verify_data_package.py → pytest
  → Pack data-package.tar.zst → Upload artifact → (optional) Release
```

In short:

1. **Export** downloads (or reuses cached) quantification matrices and writes per-matrix `features` / `biosamples` Parquet plus sharded `expression/` parts, plus top-level `matrices.json` and `manifest.json`.
2. **Hydrate** streams the pinned GENCODE GTF or NCBI GFF (gene-level rows only) into package-wide `genes.parquet` and `gene_lookup.parquet`, and fills symbols on matrix features.
3. **Sync / enrich** refresh matrix `featureTypes` from hydrated SO classes and add NCBI Gene / HGNC xrefs plus GO slim terms.
4. **Indexes** support fast global `/features` and `/biosamples` queries.
5. **Stats** ship per-gene and per-sample expression summaries and tissue ranks used by [filters](filtering-terms.md) and Explore; **percentile** Parquet files are intentionally **not** built in CI (they roughly double package size and would exceed GitHub’s 2 GiB release asset limit).
6. **Filtering terms** — base catalogs (ontology facets, `expression.percentile`, matrix facets, tissue customs) are written into the tarball.
7. **Verify + pytest** against the built package, then pack `data-package.tar.zst` as a workflow artifact (14-day retention) and optionally a Release asset.

## What the finished package looks like

```text
data-package/
  manifest.json
  matrices.json
  genes.parquet
  gene_lookup.parquet
  tissue_feature_summary.parquet
  filtering_terms.json
  filtering_terms/by_matrix/{matrixId}.json
  matrices/
    <matrix-id>/
      features.parquet
      biosamples.parquet
      feature_expression_stats.parquet
      biosample_expression_stats.parquet
      tissue_expression_stats.parquet
      expression/part-*.parquet          # shards in the release
      expression.parquet                 # after fetch merge
      percentile_in_feature.parquet      # after fetch
      percentile_in_biosample.parquet    # after fetch
```

## Fetch script (consume the release)

`scripts/fetch_data_package.py` prepares a package directory the API can serve:

1. Download the release asset (`data-package.tar.zst` from tag `data-latest` by default) via `gh`, falling back to HTTPS.
2. Safely extract into `--out` (requires `--force` if the directory is non-empty).
3. Merge expression shards into a single `expression.parquet` per matrix.
4. Reuse shipped feature / biosample / tissue stats unless missing or `--force-stats`.
5. Always build expression percentiles.
6. Rebuild filtering-term catalogs so percentile-related terms appear.

```bash
# From rnaget-beacon-demo/
python3 scripts/fetch_data_package.py --out /data/rnaget-demo --force
export DATA_PACKAGE_PATH=/data/rnaget-demo
```

Useful flags: `--skip-download` (merge an already-extracted tree), `--force-stats`, `--repo`, `--tag`, `--asset`.

Set `DATA_PACKAGE_PATH` to a directory that contains `manifest.json`. If that variable is set but the manifest is missing, the server fails at startup. When unset, the demo falls back to small JSON fixtures.

Docker Compose mounts the host package (for example `/data/rnaget-demo`) read-only at `/data/package` and sets `DATA_PACKAGE_PATH=/data/package`.

## Related

- [API](api.md)
- [Filtering terms](filtering-terms.md)
- [data-package-gha.md](data-package-gha.md) (operator notes)
