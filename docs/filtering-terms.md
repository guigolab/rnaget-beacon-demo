# Filtering terms

Beacon clients discover which filters this beacon accepts through the `/filtering_terms` informational endpoint. Catalogs are built into the [data package](data-package.md) and served at:

- `GET /filtering_terms` — all scopes (`genomicFeature`, `biosample`, `matrix`); clients filter by `scopes`
- `GET|POST /matrices/{id}/filtering_terms` — terms observed on that matrix’s features and biosamples

Filter kinds follow the Beacon framework (`ontology` | `alphanumeric` | `custom`). Filters are AND-only across separate ids.

Request shapes and live OpenAPI: [api.md](api.md). Id-by-id match rules and labels: [custom-filtering-terms.md](custom-filtering-terms.md).

## What this demo advertises

**Catalogued** (root `/filtering_terms` and UI chips):

| Area | Terms |
|---|---|
| Genomic features | SO and GO ontology facets; custom **`expression.percentile`** (Top expressed); custom **`feature.biotypeFamily`** (Gene type); alphanumeric **`feature.resource`** (Annotation resource) |
| Biosamples | UBERON / EFO tissue and cell-type facets |
| Matrices | alphanumeric **`matrix.unit`**, **`matrix.annotation`**, **`matrix.assembly.name`**; custom **`matrix.profileSource`** (Data source: encode / geo / gtex); matrix OBI assay ontology |

**Not catalogued** (and not matched for schema-true biosamples): `sex`, `condition`, `age_bracket`, `timepoint`, `biosample.preset:`.

**Match-only** (server may still accept the id; Explore uses some for heatmap bands): `tissueHigh:` / `tissueSpecific:` / `tissueTop:` / `tissuePresent:`. Gene symbols (`symbol:TP53`) and public gene ids (`HGNC:…`, `NCBIGene:…`) resolve via the gene lookup index and are not enumerated as individual terms.

Individual HGNC / NCBIGene / ENSEMBL values and gene symbols are **not** listed as terms. `resources[]` in the catalog covers namespaces in use (`so`, `go`, `uberon`, `efo`, `obi`, `mondo`, `hp`, `ncit`, `hgnc`, `ncbigene`, `ensembl`, `symbol`).

## How catalogs are created

```text
export / hydrate / enrich
        │
        ▼
build_expression_stats.py          → feature_ / biosample_expression_stats.parquet
build_tissue_expression_stats.py   → per-matrix tissue ranks
build_tissue_feature_summary.py    → package-level gene×tissue summary
        │
        ▼
build_matrix_filtering_terms.py --with-root
        → filtering_terms.json
        → filtering_terms/by_matrix/{matrixId}.json
        │
        ▼  (CI packs base catalogs; no percentiles yet)
fetch_data_package.py
        → build_expression_percentiles.py
        → rebuild filtering_terms (adds percentileIn* terms)
```

1. **Export** writes features and biosamples (with biosample enrichment such as `biosampleStatus`, phenotypic features, and GTEx measurements where curated maps exist).
2. **Hydrate / enrich** attach gene symbols, SO biotypes, cross-references, and GO slim terms used as ontology facets.
3. **Expression stats** (`scripts/build_expression_stats.py`) compute per-gene / per-sample min/max/mean/median and `median_percentile`, which back `expression.percentile` and related continuous facets.
4. **Tissue stats** support Explore heatmap bands and tissue-scoped customs.
5. **Catalog emit** (`scripts/build_matrix_filtering_terms.py --with-root`) writes Beacon-shaped catalogs during the GitHub Action.
6. **Fetch rebuild** always runs percentiles (omitted from the release for size), then rebuilds catalogs so `expression.percentileIn*` terms appear locally.

## Applying filters

On list endpoints (`GET|POST /features`, `GET|POST /biosamples`, nested matrix routes):

- Ontology example: `{"id":"SO:0001217"}` or `{"id":"UBERON:0002107"}`
- Top expressed: `{"id":"expression.percentile","operator":">=","value":"90"}`
- Gene type: `{"id":"feature.biotypeFamily","operator":"=","value":"protein_coding"}`
- GET wire for alphanumeric filters: `field:op:value` (for example `expression.percentile:>=:90`)

Ontology filters match the term id exactly; `includeDescendantTerms` is not applied (no ontology closure in the package).

## Related

- [API](api.md)
- [Data package pipeline](data-package.md)
- [Custom filtering terms (match rules)](custom-filtering-terms.md)
