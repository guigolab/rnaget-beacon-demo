# Building the RNA-Get data package (GitHub Actions)

This document explains what the **Build Parquet data package** workflow does, in plain language: why it exists, what you choose when you run it, and what comes out the other end.

The workflow file lives at `.github/workflows/build-data-package.yml`. It is started **manually** (Actions → this workflow → “Run workflow”). It does not run on every push.

---

## Why this workflow exists

The Beacon demo needs real RNA-seq expression data (genes × samples), plus enough gene metadata that people can look up a gene by **symbol** or **cross-reference** and get the native IDs used in the matrices.

Downloading those matrices and annotation catalogs on a laptop is slow and easy to get wrong. This Action builds a single **data package** on GitHub’s runners, checks that it looks complete, and optionally publishes it as a downloadable artifact or GitHub Release. That package can then be copied to storage (for example NFS) and pointed at by the API later.

---

## What datasets are included

Example matrices are listed in `scripts/profiles/datasets.yaml`. Each record has a **source** (`encode`, `geo`, or `gtex`) that picks the parser. The workflow **profiles** input is a comma-separated list of sources; every catalog matrix for those sources is built. Add another example later by appending a record to the catalog.

| Source | Roughly what it is (current catalog) |
|--------|--------------------------------------|
| **encode** | Guigo lab BLaER1 (1 biosample) and Gingeras lab GM12878 (2 biosamples); both GENCODE V24 |
| **geo** | GSE164073 (~18 samples) and GSE152418 (~34 samples); both NCBI TPM on Annotation Release 109.20190905 |
| **gtex** | GTEx v8 gene TPM for six tissues (Adipose, Liver, Whole Blood, Lung, Brain Cortex, Skeletal Muscle); GENCODE v26 |

Each record points at a public download URL and records which **genome annotation** (GTF/GFF) was used to define the gene IDs. That annotation link is used later to attach gene names and coordinates.

---

## How a run is configured

When you click **Run workflow**, you set:

| Input | Meaning |
|-------|---------|
| **profiles** | Which catalog **sources** to build, comma-separated (default: `encode,geo,gtex`) |
| **max_genes** / **max_samples** | Optional caps so you only import a slice of each matrix |
| **smoke** | If enabled, and you left the caps empty, uses a small default slice (500 genes, 20 samples) for a fast end-to-end check |
| **create_release** | If enabled, also attaches the finished archive to a GitHub Release |
| **release_tag** | Release name/tag when publishing (default `data-latest`) |

**Recommended first launch:** turn **smoke** on, leave release off, run all three profiles. When that succeeds, run again without smoke for the full package; only then turn on **create_release** if you want a Release asset.

A full GTEx-inclusive build can take a long time (the job is allowed up to six hours). Smoke mode is meant to validate the pipeline in minutes.

---

## End-to-end flow

```text
Checkout → Disk check → Python + caches → Build matrices
       → Hydrate genes → Enrich gene xrefs/GO → Feature/biosample indexes
       → Filtering terms catalog → Expression stats → Verify → Pack archive
       → Upload artifact → (optional) GitHub Release
```

### 1. Checkout and disk check

The runner checks out this repository, then confirms there is enough free disk (at least about 5 GiB). A full package is usually on the order of one to a few gigabytes; the check fails early if the machine is too tight on space.

### 2. Python and download cache

The job installs a small set of Python tools used only for export and hydration.

Downloaded matrix files and annotation files are stored under `scripts/.cache`. GitHub Actions **reuses that cache** across runs when the profile definitions have not changed, so re-runs do not always re-download everything from ENCODE, GEO, GTEx, GENCODE, or NCBI.

### 3. Build the expression package

For each selected catalog matrix (by source) the builder:

1. Downloads (or reuses) the quantification matrix.
2. Reads genes and samples (respecting any smoke/slice limits).
3. Writes a folder per matrix with:
   - a **features** table (gene rows in that matrix),
   - a **biosamples** table (sample columns),
   - **expression** data split into Parquet parts (gene-oriented shards so large matrices stay manageable).
4. Writes a top-level `matrices.json` describing each matrix in Beacon-compatible terms (units, assembly, assay type, link to the annotation file, and so on), and a `manifest.json` that indexes what was built.

At this stage gene symbols may still be sparse; the next step fills them from the official annotation files.

### 4. Hydrate genes from GTF/GFF

Using each matrix’s recorded annotation URL, the job downloads (or reuses) the matching **GENCODE GTF** or **NCBI GFF**, streams it, and keeps **gene-level** records only (no transcript/exon hierarchy for now). Rows whose type is `gene`, `pseudogene`, ends in `_gene` (for example `ncRNA_gene`), or ends in `gene_segment` (for example `V_gene_segment`) are kept; exons and transcripts are skipped.

It matches annotation genes to the IDs already present in each matrix, then writes two package-wide files:

| File | Role |
|------|------|
| **genes.parquet** | One row per hydrated gene: ID, symbol, aliases, cross-refs, chromosome coordinates, which matrices use it |
| **gene_lookup.parquet** | Search index: uppercased symbol/alias, xref, or ID → native `feature_id` |

It also updates each matrix’s local features table with symbols where available.

For each matrix the log prints how many unique feature IDs matched the annotation (for example `12000/39376 (30.5%)`). That **match rate is informational only**—a low or even zero percentage does not fail the hydrate step. (A completely empty gene catalog can still fail the later **verify** step, which checks that `genes.parquet` is non-empty when expected.)

### 5. Enrich gene annotations

`scripts/enrich_gene_annotations.py` adds **NCBI Gene / HGNC** cross-references via `gene2ensembl` + `gene_info`, and attaches **GO generic slim** terms to `ontology_terms` (alongside existing SO biotype terms).

### 6. Build feature/biosample indexes and filtering terms

`scripts/build_feature_indexes.py` writes package-root indexes for fast global `/features` and `/biosamples` queries.

`scripts/build_filtering_terms.py` emits Beacon-shaped `filtering_terms.json` (SO/GO/UBERON/EFO/MONDO/HP/NCIT facets, alphanumeric fields, matrix assay facets).

Biosample rows are enriched during export with `biosampleStatus`, `phenotypicFeatures`, `sampleProcessing`, `collectionDate`, and GTEx **measurements** (RIN as `NCIT:C63637`) using curated maps under `scripts/data/`.

### 7. Build expression stats

`scripts/build_expression_stats.py` scans each matrix’s expression Parquet and writes:

| File | Role |
|------|------|
| **feature_expression_stats.parquet** | Per-gene `min_value` / `max_value` (and argmin/argmax biosample ids) |
| **biosample_expression_stats.parquet** | Per-sample min/max (and argmin/argmax feature ids) |

It also sets `expressionValueRange` on each matrix in `matrices.json`. The API uses these tables for `sort=expression.max|expression.min` on nested feature/biosample lists.

### 8. Disk usage log

After stats, the log prints how large the cache and package folders are, so oversized runs are easy to spot.

### 9. Verify

An automatic check confirms, among other things:

- every matrix folder has features, biosamples, expression stats, and at least one expression part;
- matrix metadata still matches the Beacon matrix shape (including annotation file URLs and `expressionValueRange`);
- `genes.parquet` and `gene_lookup.parquet` exist, are non-empty, and agree with the manifest counts;
- lookup entries point at genes that actually exist in the gene catalog.

### 10. Pack and publish

Everything under `dist/data-package` is compressed into `data-package.tar.xz`.

That archive is always uploaded as a workflow **artifact** (kept for two weeks). If you enabled **create_release**, the same file is attached to the chosen GitHub Release tag (creating the release if needed, or replacing the asset on an existing tag).

Individual release files must stay under GitHub’s **2 GiB** per-asset limit; the expected full package is well under that.

---

## What the finished package looks like

```text
data-package/
  manifest.json          # index of matrices + gene catalog paths
  matrices.json          # Beacon-style matrix metadata (+ expressionValueRange)
  genes.parquet          # gene catalog (symbols, xrefs, coordinates)
  gene_lookup.parquet    # name/xref/id → gene id
  matrices/
    <matrix-id>/
      features.parquet
      biosamples.parquet
      feature_expression_stats.parquet   # per-gene min/max (axis sort)
      biosample_expression_stats.parquet # per-sample min/max (axis sort)
      expression.parquet                 # merged cells (after fetch/merge)
      expression/                        # optional shards before merge
        part-00000.parquet
        …
```

**Expression stats:** after hydrate (and after merge when using `fetch_data_package.py`), `scripts/build_expression_stats.py` writes the two stats Parquet files and sets `expressionValueRange` on each matrix in `matrices.json`. The API uses those tables for `sort=expression.max|expression.min` on nested feature/biosample lists.

**Intended use of the gene tables:** look up a gene name or cross-reference in `gene_lookup`, get the native feature IDs, then join to expression for the matrices you care about. That supports future “search by gene symbol” APIs without re-parsing GTF/GFF at query time.

---

## After the Action succeeds

1. Download the artifact (or the Release asset), **or** use the fetch script below.
2. Extract / merge somewhere durable (for example `data/package` or shared NFS).
3. Point the API at that directory with `DATA_PACKAGE_PATH` so DuckDB serves the Parquet package.

Smoke builds are for pipeline confidence only; production demos should use a **full** (non-smoke) package so gene and sample counts match the public datasets.

---

## Consume the package (fetch → merge → API)

From the repo root:

```bash
# Downloads data-latest, extracts, merges expression shards, builds expression stats
# Prod / compose host path:
sudo mkdir -p /data/rnaget-demo
# Use --force when replacing an existing non-empty --out tree
python3 scripts/fetch_data_package.py --out /data/rnaget-demo --force

# Or merge an already-extracted tree (then rebuild stats for legacy packages):
# python3 scripts/merge_expression_parquet.py --package /data/rnaget-demo
# python3 scripts/build_expression_stats.py --package /data/rnaget-demo

# Local uvicorn (no Docker):
export DATA_PACKAGE_PATH=/data/rnaget-demo
# Optional: DUCKDB_MEMORY_LIMIT=512MB DUCKDB_THREADS=2
pip install -r server/requirements.txt
cd server && uvicorn app:app --host 0.0.0.0 --port 5000
```

**CI vs consume:** the GitHub Action packs **expression shards** (`expression/part-*.parquet`). Production mounts should run `fetch_data_package.py` (or merge + `build_expression_stats.py`) so each matrix has merged `expression.parquet` plus stats. Peak disk during extract/merge is often **~3×** the final package size (cache + staging + partial merge).

Docker Compose mounts host `/data/rnaget-demo` (or `./data/rnaget-demo` in dev) at `/data/package` (ro) and sets `DATA_PACKAGE_PATH=/data/package`. That directory **must** contain `manifest.json` before starting the API: if `DATA_PACKAGE_PATH` is set but the manifest is missing, the server **fails at startup** (it no longer silently falls back to fixtures). Fixtures are used only when `DATA_PACKAGE_PATH` is unset.

After merge, each matrix has a single `expression.parquet` (shards under `expression/part-*.parquet` are removed by default). `fetch_data_package.py` also writes the expression stats parquet files and `expressionValueRange` on each matrix.

**Local prod simulation:**

```bash
python3 scripts/fetch_data_package.py --out ./data/rnaget-demo --force
docker compose -f docker-compose-dev.yml up --build
# API: http://localhost:5000/docs
# via nginx: http://localhost:94/rnaget-beacon/docs
```

---

## Common failure modes (and what they mean)

| Symptom | Likely cause |
|---------|----------------|
| Disk check fails | Runner has less than ~5 GiB free; free space or use smoke |
| Download / hydrate timeout or HTTP error | Upstream ENCODE/GEO/GTEx/GENCODE/NCBI hiccup; re-run (cache may already hold partial progress for completed files) |
| Low hydration match % in logs | Often expected for some matrices; check annotation URL / ID format only if symbols stay empty and verify later fails |
| Verify fails on genes / lookup | Hydration did not finish or wrote an empty/incomplete catalog |
| Verify fails on expression stats / `expressionValueRange` | Run `build_expression_stats.py` after hydrate (or re-run `fetch_data_package.py`) |
| API exits on boot: DATA_PACKAGE_PATH set but manifest missing | Fetch/merge into the mounted path first; or unset `DATA_PACKAGE_PATH` for fixture-only demo |
| Fetch refuses non-empty `--out` | Pass `--force` to replace, or choose a new directory |
| Release step skipped | `create_release` was left false (artifact is still available) |

---

## Related scripts (for local runs)

The same steps can be run outside Actions:

```bash
python scripts/export_parquet.py --profiles encode,geo,gtex --out dist/data-package
python scripts/hydrate_genes.py --package dist/data-package
python scripts/enrich_gene_annotations.py --package dist/data-package
python scripts/build_feature_indexes.py --package dist/data-package
python scripts/build_filtering_terms.py --package dist/data-package
python scripts/build_expression_stats.py --package dist/data-package
python scripts/verify_data_package.py --package dist/data-package
```

Matrix URLs and annotation pins live in `scripts/profiles/datasets.yaml`. Export dependencies are listed in `scripts/requirements-export.txt`.

For the Beacon HTTP contract (envelopes, paths, regenerating `rnaget-beacon-schema.yaml`), see [api.md](api.md).
