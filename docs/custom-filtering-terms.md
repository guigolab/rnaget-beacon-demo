# Custom filtering terms (features, biosamples, matrices)

This note catalogs **custom** Beacon filter ids used by the RNA-Get demo, how their
values are **computed** into the data package, how the server **matches** them, and
the friendlier **display labels** shipped in catalogs / UI chrome.

Related:

- Overview of advertised terms and catalog build: [filtering-terms.md](filtering-terms.md)
- Request shapes and catalogs: [api.md](api.md) (§ Filtering terms and `query.filters`)
- Stats parquet build: `scripts/build_expression_stats.py`
- Catalog emit: `scripts/build_filtering_terms.py`, `scripts/build_matrix_filtering_terms.py`
- Normalize / match: `server/beacon/filters.py`
- DuckDB SQL: `server/beacon/duckdb_store.py`
- Labels: `server/beacon/filter_display.py`

Beacon filter **kinds**: `ontology` | `alphanumeric` | `custom`. This document focuses
on `custom` ids (and notes closely related `expression.*` / `feature.*` / `matrix.*`
**alphanumeric** facets from the same label pass). Filters are AND-only across separate
ids; compound predicates are encoded as a **single** custom id.

---

## Catalog vs match (trimmed demo chrome)

**Catalogued** (root `/filtering_terms` and UI chips): UBERON/EFO tissues (biosample),
`expression.percentile`, `feature.biotypeFamily`, `feature.resource`, SO, matrix
`unit` / `annotation` / `assembly.name`, custom `matrix.profileSource` (Data source),
matrix OBI assay.

**Not catalogued** (and **not** matched for schema-true biosamples): `sex`, `condition`,
`age_bracket`, `timepoint`, `biosample.preset:`.

**Not catalogued** (server may still match if a client sends the id; Explore uses
synthetic `tissuePresent:` / `tissueTop:` for heatmap bands):

| Id / family | Notes |
|---|---|
| `tissueHigh:` / `tissueSpecific:` (incl. `tissueHigh:matrix:…`) | Still matched via tissue summary / stats; not advertised |
| `tissueTop:` / `tissuePresent:` | Matched; Explore paints bands via probes (not record `info`) |
| Biosample GO / HP / MONDO / NCIT / OBI | Not catalogued (matrix OBI assay remains) |
| EFO sample status (`EFO:0009654`, `EFO:0009655`) | Not catalogued |
| `matrix.scale` / `matrix.reproducible` | Still matched; not advertised |

Tissue stats parquet builders (`build_tissue_*`) remain — Explore heatmap bands and
`tissuePresent:` / `tissueTop:` depend on them. API rows for genomicFeature, biosample,
and matrix stay schema-true (no `info` bags / non-model extras).

---

## Routing rule (do not route through expression-stats SQL)

Categorical `expression.*` customs are matched against per-matrix
`feature_expression_stats` / `biosample_expression_stats` parquet (via
`_expression_feature_filter_sql` / `_expression_biosample_filter_sql`).

These **must not** use that path:

| Id | Match surface | Helpers |
|---|---|---|
| `feature.biotypeFamily` (catalog **custom**; request alphanumeric) | Feature row: `feature_type_id` ∪ `ontology_terms` | `is_biotype_family_filter` → `_feature_filter_sql` / `_matrix_feature_filter_sql` |
| `feature.resource` (alphanumeric) | Feature row: `resource` column (`featureIdentifier.resource`) | `is_feature_resource_filter` |
| `tissueHigh:` / `tissueSpecific:` (not catalogued) | `tissue_feature_summary` / `tissue_expression_stats` | `is_tissue_feature_filter` |
| `biosample.preset:` (not catalogued) | Biosample row: `sex` ∧ tissue/ontology fields | `is_biosample_preset_filter` |

`EXPRESSION_FEATURE_CUSTOM_PREFIXES` is empty (no genomicFeature expression
customs as request ids). Catalog `type` for `expression.percentile` and
`feature.biotypeFamily` is **custom** (not genomicFeature schema fields per
Beacon `filteringTermsSchema`); request wire stays alphanumeric `id` +
operator + value. `feature.resource` stays catalog alphanumeric (schema field).

---

## How expression “dot” stats are computed

Built by `scripts/build_expression_stats.py`. Writes:

- `matrices/{dir}/feature_expression_stats.parquet`
- `matrices/{dir}/biosample_expression_stats.parquet`

### Feature median percentile (`median_percentile`)

Among features with `detected_fraction > 0`, assign DuckDB `percent_rank() * 100` on
**median** expression within the matrix → `median_percentile` in \(0..100\). Undetected
features leave `median_percentile` null. Computed for **every matrix with
`n_biosamples >= 1`** (no `MIN_N` gate — single-sample ENCODE matrices included).

**Sole genomicFeature expression filter** — catalogs advertise one **custom**
term `expression.percentile` (**Top expressed**) with chip values `90` / `95` / `99`
when any feature can satisfy those thresholds. Match / request wire is still
alphanumeric `{ "id": "expression.percentile", "operator": ">=", "value": "90" }`.
Unlike `expression.median|mean|max`, this id is **root-allowed** (UNION over matrix
stats); nested `/matrices/{id}/features` joins one matrix.

Do **not** restore per-threshold custom ids `expression.percentile:>=N%`,
`expression.profile:*`, `expression.profileEnrichedIn:*`, `expression.detected*`,
exclusive quintiles, `medianLevel`, or `rangeLevel`.

Internal `detected_fraction` / biosample `detected_genes` columns may remain in stats
parquet for packaging; they are **not** advertised as filters.

---

## Label pass (friendlier catalog / UI strings)

Display labels live in `server/beacon/filter_display.py` and are applied when packaging
and (for SO) in matrix chip helpers. Machine **ids stay stable**.

| Area | Display |
|---|---|
| SO | Title-case, underscores → spaces (e.g. **Processed Pseudogene**); CURIE in chip tooltip |
| `expression.percentile` | **Top expressed**; nested: **Top expressed (this matrix)**; chips Top 10% / 5% / 1% |
| Matrix alphanumerics | **Units**, **Gene models**, **Genome**, **Collection** (`encode`/`geo`/`gtex` → Encode/GEO/GTEx in UI) |
| Gene type / resource | **Gene type** (`feature.biotypeFamily`); **Annotation resource** (`feature.resource`) |
| UI sections | **Genes** / **Tissues and samples** / **Matrices**; custom browse **Expression and gene type** |

Continuous matrix-path alphanumerics (not custom) keep descriptive labels such as
“Median expression across the cohort (unit, scale)” from
`build_matrix_filtering_terms._expression_matrix_terms`.

---

## Genomic feature — custom terms

### Lookup customs

| Id | Label (typical) | Scope | Compute / catalog | Match |
|---|---|---|---|---|
| `symbol:{SYMBOL}` | Gene symbol (lookup) | `genomicFeature` | Not enumerated in catalogs; `symbol` resource only | Alias / `gene_lookup` (glob `*` / `%` allowed) |

### Tissue high / specific (match-only; not catalogued)

Per-matrix ranks are built by `scripts/build_tissue_expression_stats.py` into
`matrices/{dir}/tissue_expression_stats.parquet`. Package-level summary
(`tissue_feature_summary.parquet`) powers **`tissueTop:`** / **`tissuePresent:`**
matching. Explore paints ≥99 / &lt;99 / none bands by probing root `/features` with
`featureIDList` plus those customs (not by embedding `info.tissueBands` on records).

Request shape if sent manually: `{ "id": "tissueHigh:UBERON:0002107" }` (custom; no
operator). Same for `tissueSpecific:` / `tissueTop:` / `tissuePresent:`.

---

## Genomic feature — catalog-custom terms with alphanumeric request wire

Catalog `type` is **custom** (not genomicFeature schema fields). Request /
normalize kind stays **alphanumeric** (`id` + operator + value).

### Top expressed (root-allowed exception)

| Id | Operator / values | Scope | Catalog | Match |
|---|---|---|---|---|
| **`expression.percentile`** | numeric ops vs `0..100` (demo chips `90`/`95`/`99`) | `genomicFeature` | Catalog type **custom**; label **Top expressed** | `median_percentile` vs op/value |

Request shape: `{ "id": "expression.percentile", "operator": ">=", "value": "90" }`
(GET wire: `expression.percentile:>=:90`).

### Gene type (filter 6) — not expression-stats

| Id | Operator / values | Scope | Catalog | Match |
|---|---|---|---|---|
| **`feature.biotypeFamily`** | `=` against `protein_coding` \| `lncRNA` \| `pseudogene` \| `sncRNA` \| `other` | `genomicFeature` | Catalog type **custom**; label **Gene type** | `feature_type_id` **or** any `ontology_terms.id` ∈ family’s SO set |

Request shape: `{ "id": "feature.biotypeFamily", "operator": "=", "value": "protein_coding" }`.

SO membership is defined in `server/beacon/biotype_families.py` (`BIOTYPE_FAMILY_SO`).
Generic gene `SO:0000704` is **not** in `protein_coding` — hydrate puts that on
`feature_type_id` for nearly all gene rows; real biotype lives in `ontology_terms`
(e.g. `SO:0001217`). UI: matrix workspace prefers family chips
(`MatrixBiotypeFamilyChips`); leaf SO remains under browse / Sequence Ontology chips.

## Genomic feature — alphanumeric terms (schema fields)

### Annotation resource

| Id | Operator / values | Scope | Catalog | Match |
|---|---|---|---|---|
| **`feature.resource`** | `=` against **`GenCode`** \| **`NCBI Gene`** | `genomicFeature` | Catalog type **alphanumeric** | `lower(resource) = gencode` or `ncbigene` |

---

## Biosample — catalogued terms

| Id | Friendly label | Scope | Catalog | Match |
|---|---|---|---|---|
| UBERON / EFO tissue & cell | ontology label | `biosample` | Tissue/cell only (no sample status EFO) | Usual biosample ontology fields |

Non-schema biosample fields (`sex`, `condition`, `age_bracket`, `timepoint`) and
`biosample.preset:` are **not** catalogued and **not** matched. API biosample rows
omit `info` and those extras.

---

## Matrix — facets

| Id | Friendly label | Type | Catalogued | Match |
|---|---|---|---|---|
| `matrix.unit` | Units | alphanumeric | yes | `expressionUnitAndScale.unit` |
| `matrix.annotation` | Gene models | alphanumeric | yes | Merged `annotation.source` + `version` |
| `matrix.assembly.name` | Genome | alphanumeric | yes | `assembly.name` |
| `matrix.profileSource` | Data source | **custom** | yes | Internal packaging metadata (`info.profileSource` on raw package records); request id `matrix.profileSource:{value}` (e.g. `matrix.profileSource:gtex`). Not exposed on API matrix docs. |
| `matrix.scale` | (n/a) | alphanumeric | **no** | `expressionUnitAndScale.scale` |
| `matrix.reproducible` | (n/a) | alphanumeric | **no** | boolean / `true`\|`false` |

Legacy split ids `matrix.annotation.source` / `.version` still match if sent.

### Continuous `expression.*` alphanumerics (matrix-path only, except percentile)

Require a bound matrix (rejected on root `/features` / `/biosamples` with “matrix-only”),
**except** `expression.percentile` (see above):

| Id | Axis | Match |
|---|---|---|
| `expression.median` / `.mean` / `.max` | feature | Stats columns vs operator/value (matrix-only) |
| `expression.percentile` | feature | `median_percentile` vs op/value (**root-allowed**) |
| `expression.value` | expressionValue | Cell value |
| `expression.percentileInFeature` / `.percentileInBiosample` | expressionValue | Optional percentile parquet |

---

## Server match surfaces (summary)

```
normalize_filters
  → kind custom for: symbol: | biosample.preset: | tissue*
  → kind alphanumeric for: expression.percentile | feature.biotypeFamily | feature.resource | matrix.* | …

axis_filter_scope / front scopeOf
  → feature | biosample | matrix | expressionValue

DuckDB
  expression.percentile      → feature_expression_stats.median_percentile
  biotypeFamily              → features parquet (type ∪ ontology_terms)  [NOT stats]
  feature.resource           → features.resource column                 [NOT stats]
  biosample.preset           → biosamples parquet (sex ∧ ontology)       [NOT stats; not catalogued]
  tissueHigh/Specific        → tissue summary / stats                   [NOT catalogued]
  symbol / SO                → gene_lookup / feature columns
```

---

## Packaging entry points

| Step | Script / module |
|---|---|
| Stats columns | `scripts/build_expression_stats.py` |
| Stats → catalog scan | `server/beacon/expression_catalog_support.py` (`scan_matrix_expression_support`) |
| Root catalog labels + terms | `scripts/build_filtering_terms.py` (`_append_expression_root_terms`, `_append_biotype_family_terms`, `_emit_resource_term`, `_pretty_so_term_labels`) |
| Per-matrix catalogs | `scripts/build_matrix_filtering_terms.py` + `matrix_axis_catalog._subset_terms` |
| Matrix alphanumeric labels | `server/beacon/matrix_catalog.py` |
| Rebuild both | `python3 scripts/build_matrix_filtering_terms.py --package … --with-root` |

---

## Out of scope (not implemented)

Ideas from the filter UX plan that were **not** shipped: additional combo filters beyond
1/3/6/8, ontology closure / descendant terms, and Beacon NOT/OR across separate filter
ids.
