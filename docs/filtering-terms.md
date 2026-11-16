# Filtering terms

Beacon clients discover which filters this beacon accepts through the `/filtering_terms` informational endpoint. Catalogs are built into the [data package](data-package.md) and served at:

- `GET /filtering_terms` — all scopes (`genomicFeature`, `biosample`, `matrix`); clients filter by `scopes`

Nested `/matrices/{id}/filtering_terms` is not part of the model or this demo.

Filter kinds are `ontology` and `alphanumeric`; nothing is advertised as `custom` any more. Filters are AND-only across separate ids.

Request shapes and live OpenAPI: [api.md](api.md). Id-by-id match rules and labels: [custom-filtering-terms.md](custom-filtering-terms.md).

## What this demo advertises

**Catalogued** (root `/filtering_terms` and UI chips):

| Area | Terms |
|---|---|
| Genomic features | SO and GO ontology facets; alphanumeric **`expression.percentile`** (Top expressed); **`feature.biotypeFamily`** (Gene type); **`feature.resource`** (Annotation resource); **`tissue.percentile:{ontologyId}`** (Explore tissue bands; one term per UBERON/EFO column; `>= 99` is the top 1%, `>= 0` is present in the tissue) |
| Biosamples | UBERON / EFO tissue and cell-type facets |
| Matrices | alphanumeric **`matrix.unit`**, **`matrix.annotation`**, **`matrix.assembly.name`**; **`matrix.source`** (Data source: encode / geo / gtex); matrix OBI assay ontology. Sequence Ontology (SO) is **not** matrix-scoped — use the features lens. |

**Not catalogued** (and not matched for schema-true biosamples): `sex`, `condition`, `age_bracket`, `timepoint`, `biosample.preset:`.

**Match-only** (server may still accept the id): `tissueHigh:` / `tissueSpecific:` (incl. `tissueHigh:matrix:…`). Gene symbols (`symbol:TP53`) and public gene ids (`HGNC:…`, `NCBIGene:…`) resolve via the gene lookup index and are not enumerated as individual terms.

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
build_filtering_terms.py
        → filtering_terms.json
        │
        ▼  (CI packs base catalog; no percentiles yet)
fetch_data_package.py
        → build_expression_percentiles.py
        → rebuild filtering_terms (adds percentileIn* terms)
```

1. **Export** writes features and biosamples (with biosample enrichment such as `biosampleStatus`, phenotypic features, and GTEx measurements where curated maps exist).
2. **Hydrate / enrich** attach gene symbols, SO biotypes, cross-references, and GO slim terms used as ontology facets.
3. **Expression stats** (`scripts/build_expression_stats.py`) compute per-gene / per-sample min/max/mean/median and `median_percentile`, which back `expression.percentile` and related continuous facets.
4. **Tissue stats** support Explore heatmap bands and tissue-scoped customs.
5. **Catalog emit** (`scripts/build_filtering_terms.py`) writes the root Beacon-shaped catalog during the GitHub Action.
6. **Fetch rebuild** always runs percentiles (omitted from the release for size), then rebuilds the root catalog so `expression.percentileIn*` terms appear locally.

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
