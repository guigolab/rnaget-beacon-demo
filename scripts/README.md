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

All example matrices live in one catalog: [`profiles/datasets.yaml`](profiles/datasets.yaml). Each record has a `source` (`encode` | `geo` | `gtex`) that selects the parser. CLI / GHA `--profiles` filters by **source** and builds every matching record. To add another example matrix, append a list item with the right `source`.

| Source | matrix_id | Notes |
|--------|-----------|--------|
| `encode` | `ENCSR622FSM` | Guigo lab ENCFF144BAP RSEM gene quants (tall: `gene_id`×TPM, 1 biosample); GENCODE v24 |
| `encode` | `ENCSR000AED` | Gingeras lab GM12878 polyA+; two RSEM gene-quant files (ENCFF902UYP + ENCFF550OHK); **same GENCODE v24** |
| `geo` | `GSE164073` | NCBI-pipeline TPM (`GeneID` × 18 GSM); Annotation Release 109.20190905 / GRCh38.p13 |
| `geo` | `GSE152418` | NCBI-pipeline TPM (~34 GSM); **same annotation** as GSE164073 |
| `geo` | `GSE107011` | NCBI-pipeline **raw** counts (~127 GSM, 29 immune cell types + PBMC); **same annotation** as GSE164073 |
| `geo` | `GSE120795` | NCBI-pipeline **FPKM** (~135 GSM, multi-tissue atlas); **same annotation** as GSE164073 |
| `gtex` | `GTEx-v8-Adipose-Subcutaneous` | GTEx v8 Adipose - Subcutaneous gene TPM GCT; GENCODE v26 (~56k × ~663) |
| `gtex` | `GTEx-v8-Liver` | GTEx v8 Liver gene TPM GCT; **same GENCODE v26** annotation pin |

**Layouts**

- `geo` — NCBI GEO RNA-seq counts wide TSV (`GeneID` + GSM columns; gzip OK)
- `encode` — ENCODE/RSEM tall gene quantifications (`gene_id`, `TPM`, …); optional `biosamples:` list merges multiple files into one matrix
- `gtex` — GTEx GCT (`#1.3`, dimension line, then `id` / `Name` / `Description` / samples)

Each record may set either `download.url` (HTTP(S), cached under `.cache/`) or `download.path` (local file relative to `scripts/`). Multi-biosample encode records put `download` under each `biosamples[]` item.

`slice.max_genes` / `max_samples` of `0` (or CLI `--max-genes 0`) means **no cap**. Built-in catalog entries default to full import; use CLI flags for smoke tests. Each source has multiple matrices, so `seed_matrix.py` requires `--matrix-id`.

Hydrate/verify peak Python RSS for smoke slices stays near ~500MB; full GTEx-scale packages can spike higher during per-matrix feature rewrite — prefer `--max-genes` on memory-constrained runners. The API DuckDB process stays capped at 512MB separately.

## Seed

```bash
# GEO GSE164073 NCBI TPM (full GeneID × GSM matrix)
python scripts/seed_matrix.py --profile geo --matrix-id GSE164073

# Smoke-test GEO
python scripts/seed_matrix.py --profile geo --matrix-id GSE164073 --max-genes 500 --max-samples 6

# GTEx Adipose-Subcutaneous (full tissue TPM matrix; large — streams COPY)
python scripts/seed_matrix.py --profile gtex --matrix-id GTEx-v8-Adipose-Subcutaneous

# Smoke-test GTEx with a small slice
python scripts/seed_matrix.py --profile gtex --matrix-id GTEx-v8-Liver --max-genes 500 --max-samples 20

# ENCODE Guigo BLaER1 cytosolic polyA+ (full gene set)
python scripts/seed_matrix.py --profile encode --matrix-id ENCSR622FSM

# Smoke-test multi-biosample encode with a gene cap
python scripts/seed_matrix.py --profile encode --matrix-id ENCSR000AED --max-genes 200

# Use cached file only
python scripts/seed_matrix.py --profile geo --matrix-id GSE164073 --skip-download

# Metadata or expression cells only
python scripts/seed_matrix.py --profile geo --matrix-id GSE164073 --meta-only
python scripts/seed_matrix.py --profile geo --matrix-id GSE164073 --expression-only

# Custom single-record YAML, or the catalog with --profile / --matrix-id
python scripts/seed_matrix.py --config scripts/profiles/datasets.yaml --profile geo --matrix-id GSE152418
```

Re-running the same matrix **replaces** that `matrix_id`’s expression rows and membership links, and upserts matrix / feature / biosample metadata.

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
  feature_ontology.parquet  # SO edges for fast /features filters (after build_feature_indexes)
  feature_index.parquet     # deduped global feature catalog + point lookup
  feature_matrix.parquet    # wrapper_id × matrix_id membership
  biosamples.parquet        # package-level deduped biosamples
  biosample_matrix.parquet  # biosample_id × matrix_id membership
  filtering_terms.json    # Beacon filtering_terms catalog (after build_filtering_terms)
  matrices/{matrix_id}/
    features.parquet      # symbol, aliases, xrefs, ontology_terms, chrom/start/end/strand, …
    biosamples.parquet    # OBI origin type + detail ontology, sex, donor, …
    expression/part-*.parquet   # long cells; sharded by md5(feature_id)
```

Expression shards are **gene-keyed** so TP53-style queries touch one (or few) parts. Biosample ontology enables “samples with ontology X where gene Y is high/low” after a join on `(matrix_id, biosample_id)`.

### Feature / biosample indexes (`build_feature_indexes.py`)

Runs **after** `hydrate_genes`, **before** `build_filtering_terms`. Scans each matrix’s `features.parquet` / `biosamples.parquet` (column projection) and writes package-root indexes so global `/features` and `/biosamples` avoid `UNION ALL` + `UNNEST`:

| File | Role |
|---|---|
| `feature_ontology.parquet` | `(feature_id, ontology_id, role)` — SO filters without unnesting nested terms |
| `feature_index.parquet` | One row per `wrapper_id` (catalog + `GET /features/{id}`) including nested `ontology_terms` for payloads |
| `feature_matrix.parquet` | Membership links for `matrixIds` |
| `biosamples.parquet` / `biosample_matrix.parquet` | Global biosample catalog + membership |

Manifest stamps `feature*Path` / `biosamplesPath` / `biosampleMatrixPath` and `features.numUnique` / `biosamples.numUnique`. Older packages without these files still load (store falls back to the union views).

### Filtering terms catalog (`build_filtering_terms.py`)

Runs **after** `build_feature_indexes`. Writes a small Beacon-shaped `filtering_terms.json`:

- **Facets:** DISTINCT SO (`feature_type` + biotype `ontology_terms`), UBERON/EFO biosample ontology ids, custom `resource:*` (except `resource:gencode`)
- **Fields:** alphanumeric `genomicFeature.symbol`, `sex` (not every symbol value)
- **Resources:** `so`, `uberon`, `efo`, plus `hgnc` / `ncbigene` / `ensembl` namespaces — **never** one filteringTerm per HGNC/NCBIGene

CI order: `export_parquet` → `hydrate_genes` → `sync_matrix_feature_types` → **`enrich_gene_annotations`** → **`build_feature_indexes`** → `build_expression_stats` → **`build_matrix_filtering_terms`** → `verify`.

Curated biosample maps: `scripts/data/geo_biosample_status.json`, `scripts/data/biosample_measurements.json` (plus existing `geo_biosample_ontology.json`).

### Gene hydration (`hydrate_genes.py`)

Runs after export. Streams each matrix’s annotation GTF/GFF and keeps **only genes that appear in that matrix’s `features.parquet`**.

- **`featureType`** (per genomic feature): Sequence Ontology term for GFF/GTF **column 3** (`gene` → `SO:0000704`, `pseudogene` → `SO:0000336`, …) via [`scripts/data/gff_type_to_so.json`](data/gff_type_to_so.json) + cached `so.obo`.
- **`featureTypes`** (per matrix): distinct SO classes present among that matrix's features (seeded from profile `feature_types`, then synced after hydrate by `sync_matrix_feature_types.py`).
- **`ontologyTerms`**: SO terms for `gene_type` / `gene_biotype` ([`scripts/data/biotype_to_so.json`](data/biotype_to_so.json)) plus any GFF `Ontology_term` attributes — never written into `featureType`.
- **`xrefs`**: normalized `Dbxref` CURIEs (`NCBIGene`, `HGNC`, `MIM`, …). GENCODE rows are further enriched from `Homo_sapiens.gene_info.gz` when the gene **symbol uniquely** matches a primary NCBI Symbol (ambiguous symbols are skipped).
- **`genomicInterval` coords**: copies `chrom` / `start` / `end` / `strand` onto `features.parquet`. The API maps primary GRCh38 contigs to `refseq:NC_…` ([`server/beacon/data/grch38_contig_to_refseq.json`](../server/beacon/data/grch38_contig_to_refseq.json)) and emits VRS `SequenceLocation` (GFF 1-based inclusive → 0-based interbase). Unmapped contigs omit the interval. Gene `relationship` is not populated.
- **`annotation.md5Checksum`**: MD5 of the cached annotation file stamped onto each matching `matrices.json` entry.
- Maps are validated against downloaded SO OBO at hydrate time (`scripts/so_map.py`).

### Biosample enrichment (`export_enrichment.enrich_biosamples`)

Ontology-only (id + label pairs). Whenever an ontology id is written, a non-empty label is required in the same step.

- **`sampleOriginType`**: OBI material category — `OBI:0001876` / `cell culture` (ENCODE), `OBI:0001479` / `specimen from organism` (GTEx/GEO).
- **`sampleOriginDetail`** (`ontology_id` + `ontology_label`):
  - **encode** — ENCBS `biosample_ontology.term_id` + `term_name` (cached JSON); fallback catalog `sampleType`.
  - **gtex** — catalog `tissue.id` + `tissue.label` (UBERON).
  - **geo** — series SOFT characteristics mapped via [`scripts/data/geo_biosample_ontology.json`](data/geo_biosample_ontology.json) (prefer UBERON over EFO). Unmapped GSMs keep `ontology_source=GEO` with null detail (no dedicated filtering facet).
- Sex / donor / summary / lab may still be copied from catalog parsers when present, but are **not** enrichment goals of this pass. Clinical/pathology Beacon fields stay absent.

### CI

Workflow: [`.github/workflows/build-data-package.yml`](../.github/workflows/build-data-package.yml)

- `workflow_dispatch` with profile list, optional slice limits, optional GitHub Release upload
- Uploads `data-package.tar.zst` as an Actions artifact
- With `create_release=true`, attaches the tarball to tag `data-latest` (or your tag)

**CI ships expression shards** (`expression/part-*.parquet`) plus **expression stats** and base filtering_terms (no percentiles). Before mounting for the API, run fetch: download → extract → merge → reuse shipped stats (or rebuild with `--force-stats`) → percentiles → rebuild filtering_terms. See [docs/data-package-gha.md](../docs/data-package-gha.md) for disk budget (~3× package during extract/merge) and fail-fast notes.

On the API host:

```bash
# Preferred: download, safe extract, merge, reuse stats, percentiles, filtering_terms
python3 scripts/fetch_data_package.py --out /data/rnaget-demo --force

export DATA_PACKAGE_PATH=/data/rnaget-demo
# Optional: DUCKDB_MEMORY_LIMIT=512MB DUCKDB_THREADS=2
cd server && uvicorn app:app --host 0.0.0.0 --port 5000
```

If `DATA_PACKAGE_PATH` is set but `manifest.json` is missing, the API **exits at startup** (no silent fixture fallback).
