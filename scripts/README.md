# Matrix download + seed scripts

Offline pipeline to download RNA-seq quantification matrices and seed **PostgreSQL**:

- **Metadata** — `matrices`, `features`, `biosamples` (+ membership junction tables)
- **Expression** — `expression_values` fact table (native feature ids × biosamples)

The FastAPI demo serves Beacon envelopes from fixtures or a Parquet package (`DATA_PACKAGE_PATH`). These scripts prepare an optional Postgres store for offline seeding; they are not required to run the Beacon API.

## Setup

```bash
cd rnaget-beacon-demo
python -m venv scripts/.venv
source scripts/.venv/bin/activate
pip install -r scripts/requirements.txt
```

Start Postgres (dev compose):

```bash
docker compose -f docker-compose-dev.yml up -d postgres
```

Apply DDL once (also auto-applied on first Postgres container init):

```bash
psql "$DATABASE_URL" -f scripts/sql/001_schema.sql
# or:
# PGPASSWORD=beacon psql -h localhost -U beacon -d rnaget_beacon -f scripts/sql/001_schema.sql
```

### Environment

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | Postgres URL | `postgresql://beacon:beacon@localhost:5432/rnaget_beacon` |

Falls back to `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` if `DATABASE_URL` is unset (defaults: `localhost:5432`, user/password/db `beacon` / `beacon` / `rnaget_beacon`).

## Profiles

| Profile | File | Notes |
|---------|------|--------|
| `geo` | `profiles/geo.yaml` | Runnable **GSE164073** NCBI-pipeline TPM (`GeneID` × 18 GSM); **full matrix** by default (~39k × 18). Reproducible HISAT2 + featureCounts on GRCh38.p13 |
| `encode` | `profiles/encode.yaml` | Runnable Guigo lab **ENCSR622FSM** / ENCFF144BAP RSEM gene quants (tall: `gene_id`×TPM, 1 biosample); **full ENSG set** by default |
| `gtex` | `profiles/gtex.yaml` | Runnable GTEx v8 **Adipose - Subcutaneous** gene TPM GCT; **full tissue matrix** by default (~56k genes × ~663 samples ≈ 37M cells, streamed into Postgres) |

**Layouts**

- `geo` — NCBI GEO RNA-seq counts wide TSV (`GeneID` + GSM columns; gzip OK)
- `encode` — ENCODE/RSEM tall gene quantifications (`gene_id`, `TPM`, …)
- `gtex` — GTEx GCT (`#1.3`, dimension line, then `id` / `Name` / `Description` / samples)

Each profile may set either `download.url` (HTTP(S), cached under `.cache/`) or `download.path` (local file relative to `scripts/`).

`slice.max_genes` / `max_samples` of `0` (or CLI `--max-genes 0`) means **no cap**. All three built-in profiles default to full import; use CLI flags for smoke tests.

## Seed

```bash
# GEO GSE164073 NCBI TPM (full GeneID × GSM matrix)
python scripts/seed_matrix.py --profile geo

# Smoke-test GEO
python scripts/seed_matrix.py --profile geo --max-genes 500 --max-samples 6

# GTEx Adipose-Subcutaneous (full tissue TPM matrix; large — streams COPY)
python scripts/seed_matrix.py --profile gtex

# Smoke-test GTEx with a small slice
python scripts/seed_matrix.py --profile gtex --max-genes 500 --max-samples 20

# ENCODE Guigo BLaER1 cytosolic polyA+ (full gene set)
python scripts/seed_matrix.py --profile encode

# Smoke-test encode with a gene cap
python scripts/seed_matrix.py --profile encode --max-genes 200

# Use cached file only
python scripts/seed_matrix.py --profile geo --skip-download

# Metadata or expression cells only
python scripts/seed_matrix.py --profile geo --meta-only
python scripts/seed_matrix.py --profile geo --expression-only

# Custom profile file
python scripts/seed_matrix.py --config scripts/profiles/geo.yaml
```

Re-running the same profile **replaces** that `matrix_id`’s expression rows and membership links, and upserts matrix / feature / biosample metadata.

Downloads are cached under `scripts/.cache/` (gitignored).

## Parquet data package (GitHub Actions / NFS sync)

For reload-friendly serving (discovery then slice) without reseeding Postgres on NFS, export **Parquet + JSON**:

```bash
pip install -r scripts/requirements-export.txt

# Smoke (small)
python scripts/export_parquet.py --profiles encode,geo,gtex \
  --out dist/data-package --max-genes 200 --max-samples 10

# Full matrices (large for gtex)
python scripts/export_parquet.py --profiles encode,geo,gtex --out dist/data-package
```

Package layout:

```
data-package/
  manifest.json
  matrices.json
  genes.parquet           # matrix-linked genes only (after hydrate_genes)
  gene_lookup.parquet     # symbol / alias / xref → feature_id
  filtering_terms.json    # Beacon filtering_terms catalog (after build_filtering_terms)
  matrices/{matrix_id}/
    features.parquet      # gene discovery (symbol, aliases, xrefs, ontology_terms, …)
    biosamples.parquet    # sample discovery (ontology_id/label, …)
    expression/part-*.parquet   # long cells; sharded by md5(feature_id)
```

Expression shards are **gene-keyed** so TP53-style queries touch one (or few) parts. Biosample ontology enables “samples with ontology X where gene Y is high/low” after a join on `(matrix_id, biosample_id)`.

### Filtering terms catalog (`build_filtering_terms.py`)

Runs **after** `hydrate_genes`. Writes a small Beacon-shaped `filtering_terms.json`:

- **Facets:** DISTINCT SO (`feature_type` + biotype `ontology_terms`), UBERON/EFO biosample ontology ids, custom `GEO:sample` / `resource:*`
- **Fields:** alphanumeric `genomicFeature.symbol`, `sex` (not every symbol value)
- **Resources:** `so`, `uberon`, `efo`, plus `hgnc` / `ncbigene` / `ensembl` namespaces — **never** one filteringTerm per HGNC/NCBIGene

CI order: `export_parquet` → `hydrate_genes` → **`build_filtering_terms`** → `build_expression_stats` → `verify`.

### Gene hydration (`hydrate_genes.py`)

Runs after export. Streams each matrix’s annotation GTF/GFF and keeps **only genes that appear in that matrix’s `features.parquet`**.

- **`featureType`**: Sequence Ontology term for GFF/GTF **column 3** (`gene` → `SO:0000704`, `pseudogene` → `SO:0000336`, …) via [`scripts/data/gff_type_to_so.json`](data/gff_type_to_so.json) + cached `so.obo`.
- **`ontologyTerms`**: SO terms for `gene_type` / `gene_biotype` ([`scripts/data/biotype_to_so.json`](data/biotype_to_so.json)) plus any GFF `Ontology_term` attributes — never written into `featureType`.
- **`xrefs`**: normalized `Dbxref` CURIEs (`NCBIGene`, `HGNC`, `MIM`, …). GENCODE rows are further enriched from `Homo_sapiens.gene_info.gz` when the gene **symbol uniquely** matches a primary NCBI Symbol (ambiguous symbols are skipped).
- Maps are validated against downloaded SO OBO at hydrate time (`scripts/so_map.py`).

### CI

Workflow: [`.github/workflows/build-data-package.yml`](../.github/workflows/build-data-package.yml)

- `workflow_dispatch` with profile list, optional slice limits, optional GitHub Release upload
- Uploads `data-package.tar.xz` as an Actions artifact
- With `create_release=true`, attaches the tarball to tag `data-latest` (or your tag)

**CI ships expression shards** (`expression/part-*.parquet`). Before mounting for the API, run fetch (download → extract → merge → expression stats). See [docs/data-package-gha.md](../docs/data-package-gha.md) for disk budget (~3× package during extract/merge) and fail-fast notes.

On the API host:

```bash
# Preferred: download, safe extract, merge shards, build stats
python3 scripts/fetch_data_package.py --out /data/rnaget-demo --force

export DATA_PACKAGE_PATH=/data/rnaget-demo
# Optional: DUCKDB_MEMORY_LIMIT=512MB DUCKDB_THREADS=2
cd server && uvicorn app:app --host 0.0.0.0 --port 5000
```

If `DATA_PACKAGE_PATH` is set but `manifest.json` is missing, the API **exits at startup** (no silent fixture fallback).
