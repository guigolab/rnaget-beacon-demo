# Building the RNA-Get data package (GitHub Actions)

This document explains what the **Build Parquet data package** workflow does, in plain language: why it exists, what you choose when you run it, and what comes out the other end.

The workflow file lives at `.github/workflows/build-data-package.yml`. It is started **manually** (Actions → this workflow → “Run workflow”). It does not run on every push.

---

## Why this workflow exists

The Beacon demo needs real RNA-seq expression data (genes × samples), plus enough gene metadata that people can look up a gene by **symbol** or **cross-reference** and get the native IDs used in the matrices.

Downloading those matrices and annotation catalogs on a laptop is slow and easy to get wrong. This Action builds a single **data package** on GitHub’s runners, checks that it looks complete, and optionally publishes it as a downloadable artifact or GitHub Release. That package can then be copied to storage (for example NFS) and pointed at by the API later.

---

## What datasets are included

Three profiles are supported (you can run any subset):

| Profile | Roughly what it is |
|---------|-------------------|
| **encode** | One ENCODE gene quantification file (Guigo lab experiment), genes × one sample |
| **geo** | GEO series GSE164073, NCBI-standardized TPM, genes × 18 samples |
| **gtex** | GTEx v8 Adipose – Subcutaneous gene TPM, many genes × hundreds of samples (by far the largest) |

Each profile points at a public download URL and records which **genome annotation** (GTF/GFF) was used to define the gene IDs. That annotation link is used later to attach gene names and coordinates.

---

## How a run is configured

When you click **Run workflow**, you set:

| Input | Meaning |
|-------|---------|
| **profiles** | Which datasets to build, comma-separated (default: all three) |
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
       → Hydrate genes from annotations → Verify → Pack archive
       → Upload artifact → (optional) GitHub Release
```

### 1. Checkout and disk check

The runner checks out this repository, then confirms there is enough free disk (at least about 5 GiB). A full package is usually on the order of one to a few gigabytes; the check fails early if the machine is too tight on space.

### 2. Python and download cache

The job installs a small set of Python tools used only for export and hydration.

Downloaded matrix files and annotation files are stored under `scripts/.cache`. GitHub Actions **reuses that cache** across runs when the profile definitions have not changed, so re-runs do not always re-download everything from ENCODE, GEO, GTEx, GENCODE, or NCBI.

### 3. Build the expression package

For each selected profile the builder:

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

### 5. Disk usage log

After hydration, the log prints how large the cache and package folders are, so oversized runs are easy to spot.

### 6. Verify

An automatic check confirms, among other things:

- every matrix folder has features, biosamples, and at least one expression part;
- matrix metadata still matches the Beacon matrix shape (including annotation file URLs);
- `genes.parquet` and `gene_lookup.parquet` exist, are non-empty, and agree with the manifest counts;
- lookup entries point at genes that actually exist in the gene catalog.

### 7. Pack and publish

Everything under `dist/data-package` is compressed into `data-package.tar.xz`.

That archive is always uploaded as a workflow **artifact** (kept for two weeks). If you enabled **create_release**, the same file is attached to the chosen GitHub Release tag (creating the release if needed, or replacing the asset on an existing tag).

Individual release files must stay under GitHub’s **2 GiB** per-asset limit; the expected full package is well under that.

---

## What the finished package looks like

```text
data-package/
  manifest.json          # index of matrices + gene catalog paths
  matrices.json          # Beacon-style matrix metadata
  genes.parquet          # gene catalog (symbols, xrefs, coordinates)
  gene_lookup.parquet    # name/xref/id → gene id
  matrices/
    <matrix-id>/
      features.parquet
      biosamples.parquet
      expression/
        part-00000.parquet
        …
```

**Intended use of the gene tables:** look up a gene name or cross-reference in `gene_lookup`, get the native feature IDs, then join to expression for the matrices you care about. That supports future “search by gene symbol” APIs without re-parsing GTF/GFF at query time.

---

## After the Action succeeds

1. Download the artifact (or the Release asset).
2. Extract it somewhere durable (for example shared NFS).
3. Point the Beacon / RNA-Get service at that directory when the DuckDB (or other) store is wired up.

Smoke builds are for pipeline confidence only; production demos should use a **full** (non-smoke) package so gene and sample counts match the public datasets.

---

## Common failure modes (and what they mean)

| Symptom | Likely cause |
|---------|----------------|
| Disk check fails | Runner has less than ~5 GiB free; free space or use smoke |
| Download / hydrate timeout or HTTP error | Upstream ENCODE/GEO/GTEx/GENCODE/NCBI hiccup; re-run (cache may already hold partial progress for completed files) |
| Low hydration match % in logs | Often expected for some matrices; check annotation URL / ID format only if symbols stay empty and verify later fails |
| Verify fails on genes / lookup | Hydration did not finish or wrote an empty/incomplete catalog |
| Release step skipped | `create_release` was left false (artifact is still available) |

---

## Related scripts (for local runs)

The same steps can be run outside Actions:

```bash
python scripts/export_parquet.py --profiles encode,geo,gtex --out dist/data-package
python scripts/hydrate_genes.py --package dist/data-package
python scripts/verify_data_package.py --package dist/data-package
```

Profile URLs and annotation pins live under `scripts/profiles/`. Export dependencies are listed in `scripts/requirements-export.txt`.
