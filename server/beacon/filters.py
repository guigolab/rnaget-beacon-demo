"""Beacon query.filters normalization and matching helpers."""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

FEATURE_ONTOLOGY_PREFIXES = frozenset({"SO", "GO"})
BIOSAMPLE_ONTOLOGY_PREFIXES = frozenset(
    {"UBERON", "EFO", "OBI", "GO", "MONDO", "HP", "NCIT"}
)
GENE_PUBLIC_ID_PREFIXES = frozenset({"HGNC", "NCBIGENE", "ENSEMBL"})
FEATURE_BIOTYPE_FAMILY_ID = "feature.biotypeFamily"
FEATURE_RESOURCE_ID = "feature.resource"

# Catalog / request display values → stored feature.resource column values.
FEATURE_RESOURCE_VALUE_TO_STORED: Dict[str, str] = {
    "NCBI Gene": "ncbigene",
    "GenCode": "gencode",
    "ncbigene": "ncbigene",
    "ncbi": "ncbigene",
    "gencode": "gencode",
}
FEATURE_RESOURCE_CATALOG_VALUES: Tuple[str, ...] = ("GenCode", "NCBI Gene")

ALPHANUMERIC_FEATURE_FIELDS: frozenset[str] = frozenset(
    {FEATURE_BIOTYPE_FAMILY_ID, FEATURE_RESOURCE_ID}
)
ALPHANUMERIC_BIOSAMPLE_FIELDS: frozenset[str] = frozenset()
NUMERIC_BIOSAMPLE_FIELDS = frozenset({"rin", "ischemic_time_min"})
MATRIX_ALPHANUMERIC_FIELDS = frozenset(
    {
        "matrix.unit",
        "matrix.scale",
        "matrix.annotation",
        # Legacy split ids (accepted for matching; catalogs emit matrix.annotation).
        "matrix.annotation.source",
        "matrix.annotation.version",
        "matrix.assembly.name",
        "matrix.reproducible",
    }
)
MATRIX_PROFILE_SOURCE_ID = "matrix.profileSource"
MATRIX_PROFILE_SOURCE_PREFIX = "matrix.profileSource:"
CUSTOM_MATRIX_IDS = frozenset({MATRIX_PROFILE_SOURCE_ID})
CUSTOM_BIOSAMPLE_IDS: frozenset[str] = frozenset()
ALPHANUMERIC_OPS = frozenset({"=", "!", "<", ">", "<=", ">="})

# Continuous expression.* terms on genomicFeature.
# Median/mean/max are matrix-only; expression.percentile is root-allowed
# (UNION over per-matrix median_percentile).
EXPRESSION_FEATURE_ALPHANUMERIC = frozenset(
    {
        "expression.median",
        "expression.mean",
        "expression.max",
        "expression.percentile",
    }
)
EXPRESSION_FEATURE_ROOT_ALLOWED_ALPHANUMERIC = frozenset(
    {
        "expression.percentile",
    }
)
EXPRESSION_BIOSAMPLE_ALPHANUMERIC: frozenset[str] = frozenset()
EXPRESSION_VALUE_ALPHANUMERIC = frozenset(
    {
        "expression.value",
        "expression.percentileInFeature",
        "expression.percentileInBiosample",
    }
)
# Custom genomicFeature expression.* prefixes (none remaining).
EXPRESSION_FEATURE_CUSTOM_PREFIXES: tuple[str, ...] = ()
BIOSAMPLE_PRESET_PREFIX = "biosample.preset:"
EXPRESSION_BIOSAMPLE_CUSTOM_PREFIXES: tuple[str, ...] = ()
TISSUE_HIGH_PREFIX = "tissueHigh:"
TISSUE_SPECIFIC_PREFIX = "tissueSpecific:"
TISSUE_TOP_PREFIX = "tissueTop:"
TISSUE_PRESENT_PREFIX = "tissuePresent:"
TISSUE_FEATURE_CUSTOM_PREFIXES: tuple[str, ...] = (
    TISSUE_HIGH_PREFIX,
    TISSUE_SPECIFIC_PREFIX,
    TISSUE_TOP_PREFIX,
    TISSUE_PRESENT_PREFIX,
)


def matrix_profile_source(doc: Dict[str, Any]) -> Optional[str]:
    """Internal packaging profile source (not a matrix schema property).

    Reads side-channel metadata kept for filtering/catalogs. Prefer explicit
    top-level ``_profileSource`` (set when sanitizing API docs), then legacy
    ``info.profileSource`` / ``info.catalogSource`` on raw package records.
    """
    raw = doc.get("_profileSource")
    if raw is not None and str(raw).strip():
        return str(raw).strip()
    info = doc.get("info") or {}
    if isinstance(info, dict):
        for key in ("profileSource", "catalogSource"):
            val = info.get(key)
            if val is not None and str(val).strip():
                return str(val).strip()
    return None


def matrix_profile_source_filter_value(fid: str) -> Optional[str]:
    """Extract value from ``matrix.profileSource`` or ``matrix.profileSource:gtex``."""
    if fid == MATRIX_PROFILE_SOURCE_ID:
        return None
    if fid.startswith(MATRIX_PROFILE_SOURCE_PREFIX):
        val = fid[len(MATRIX_PROFILE_SOURCE_PREFIX) :].strip()
        return val or None
    return None


def is_matrix_profile_source_filter_id(fid: str) -> bool:
    return fid == MATRIX_PROFILE_SOURCE_ID or fid.startswith(MATRIX_PROFILE_SOURCE_PREFIX)


def is_matrix_profile_source_filter(f: "NormalizedFilter") -> bool:
    return f.kind == "custom" and is_matrix_profile_source_filter_id(f.id)


def matrix_annotation_filter_value(
    source: Optional[str], version: Optional[str]
) -> Optional[str]:
    """Merge annotation source + version into one facet value (e.g. gencodeV24)."""
    src = (source or "").strip()
    ver = (version or "").strip()
    if not src and not ver:
        return None
    if not ver:
        return src
    if not src:
        return ver
    if ver[0].isalpha():
        return f"{src}{ver[0].upper()}{ver[1:]}"
    return f"{src}{ver}"


def is_symbol_custom_filter_id(fid: str) -> bool:
    return fid.lower().startswith("symbol:")


def symbol_id_lookup_key(fid: str) -> str:
    if ":" not in fid:
        return ""
    return fid.split(":", 1)[1].strip()


@dataclass(frozen=True)
class NormalizedFilter:
    kind: str  # ontology | alphanumeric | custom
    id: str
    operator: Optional[str] = None
    value: Optional[str] = None
    scope: Optional[str] = None
    prefix: Optional[str] = None  # upper-case CURIE prefix when ontology


def _curie_prefix(term_id: str) -> Optional[str]:
    if ":" not in term_id:
        return None
    return term_id.split(":", 1)[0].upper().replace("_", "")


def normalize_ontology_id(term_id: str) -> str:
    """Normalize Ensembl: / ENSEMBL: and HGNC:HGNC:N forms for lookup."""
    if ":" not in term_id:
        return term_id
    prefix, rest = term_id.split(":", 1)
    pref_u = prefix.upper()
    if pref_u in ("ENSEMBL", "ENSEMBLGENE"):
        return f"ENSEMBL:{rest}"
    if pref_u == "HGNC" and rest.upper().startswith("HGNC:"):
        return f"HGNC:{rest.split(':', 1)[1]}"
    if pref_u in ("GENEID", "NCBIGENE", "NCBIGENEID"):
        return f"NCBIGene:{rest}"
    if pref_u == "NCBIGENE":
        return f"NCBIGene:{rest}"
    if pref_u == "HGNC":
        return f"HGNC:{rest}"
    if pref_u == "SO":
        return f"SO:{rest}"
    if pref_u == "UBERON":
        return f"UBERON:{rest}"
    if pref_u == "EFO":
        return f"EFO:{rest}"
    return term_id


def _as_dict(item: Any) -> Dict[str, Any]:
    if isinstance(item, dict):
        return item
    if hasattr(item, "model_dump"):
        return item.model_dump(mode="json", exclude_none=True)
    if hasattr(item, "dict"):
        return item.dict(exclude_none=True)
    return dict(item)


def normalize_filters(raw: Optional[Sequence[Any]]) -> List[NormalizedFilter]:
    out: List[NormalizedFilter] = []
    if not raw:
        return out
    for item in raw:
        d = _as_dict(item)
        fid = d.get("id")
        if not fid:
            raise ValueError("filter missing id")
        fid = str(fid)
        if "operator" in d and d.get("operator") is not None:
            op = str(d.get("operator") or "=")
            if op not in ALPHANUMERIC_OPS:
                raise ValueError(f"unsupported alphanumeric operator: {op}")
            if d.get("value") is None:
                raise ValueError(f"alphanumeric filter {fid!r} requires value")
            out.append(
                NormalizedFilter(
                    kind="alphanumeric",
                    id=fid,
                    operator=op,
                    value=str(d["value"]),
                    scope=str(d["scope"]) if d.get("scope") else None,
                )
            )
            continue
        if (
            fid in ALPHANUMERIC_FEATURE_FIELDS
            or fid in ALPHANUMERIC_BIOSAMPLE_FIELDS
            or fid in NUMERIC_BIOSAMPLE_FIELDS
            or fid in MATRIX_ALPHANUMERIC_FIELDS
            or fid in EXPRESSION_FEATURE_ALPHANUMERIC
            or fid in EXPRESSION_BIOSAMPLE_ALPHANUMERIC
            or fid in EXPRESSION_VALUE_ALPHANUMERIC
        ):
            raise ValueError(
                f"alphanumeric filter {fid!r} requires operator and value"
            )
        if (
            fid.lower().startswith("symbol:")
            or fid.startswith(BIOSAMPLE_PRESET_PREFIX)
            or fid in CUSTOM_BIOSAMPLE_IDS
            or is_matrix_profile_source_filter_id(fid)
            or fid.startswith(EXPRESSION_FEATURE_CUSTOM_PREFIXES)
            or fid.startswith(EXPRESSION_BIOSAMPLE_CUSTOM_PREFIXES)
            or fid.startswith(TISSUE_FEATURE_CUSTOM_PREFIXES)
        ):
            out.append(
                NormalizedFilter(
                    kind="custom",
                    id=fid,
                    scope=str(d["scope"]) if d.get("scope") else None,
                )
            )
            continue
        pref = _curie_prefix(fid)
        out.append(
            NormalizedFilter(
                kind="ontology",
                id=normalize_ontology_id(fid),
                scope=str(d["scope"]) if d.get("scope") else None,
                prefix=pref,
            )
        )
    return out


_GET_FILTER_OPS = (">=", "<=", "!=", "=", "!", ">", "<")


def _token_to_raw_filter(token: str) -> Dict[str, Any]:
    """Parse ``id`` or ``field:op:value`` (op is =, !, <, >, <=, >=, !=).

    CURIEs such as ``UBERON:0002107`` stay ontology filters. Alphanumeric GET
    filters use a colon on both sides of the operator, for example ``rin:>=:7``.
    """
    known = (
        ALPHANUMERIC_FEATURE_FIELDS
        | ALPHANUMERIC_BIOSAMPLE_FIELDS
        | NUMERIC_BIOSAMPLE_FIELDS
        | MATRIX_ALPHANUMERIC_FIELDS
        | EXPRESSION_FEATURE_ALPHANUMERIC
        | EXPRESSION_BIOSAMPLE_ALPHANUMERIC
        | EXPRESSION_VALUE_ALPHANUMERIC
    )
    for op in _GET_FILTER_OPS:
        marker = f":{op}:"
        if marker not in token:
            continue
        left, right = token.split(marker, 1)
        if left in known and right != "":
            return {
                "id": left,
                "operator": "!" if op == "!=" else op,
                "value": right,
            }
    return {"id": token}


def parse_get_filters_csv(raw: Optional[str]) -> List[NormalizedFilter]:
    if not raw or not str(raw).strip():
        return []
    tokens = [p.strip() for p in str(raw).split(",") if p.strip()]
    return normalize_filters([_token_to_raw_filter(t) for t in tokens])


# Biosample material-entity OBI terms. Other OBI ids are matrix assay types.
BIOSAMPLE_OBI_ORIGIN = frozenset({"OBI:0001876", "OBI:0001479"})


def is_expression_custom_feature(f: NormalizedFilter) -> bool:
    """Categorical expression.* custom ids matched against feature expression stats."""
    return any(f.id.startswith(p) for p in EXPRESSION_FEATURE_CUSTOM_PREFIXES)


def is_tissue_feature_filter_id(fid: str) -> bool:
    return any(fid.startswith(p) for p in TISSUE_FEATURE_CUSTOM_PREFIXES)


def is_tissue_feature_filter(f: NormalizedFilter) -> bool:
    """Custom tissueHigh: / tissueSpecific: ids on genomicFeature."""
    return f.kind == "custom" and is_tissue_feature_filter_id(f.id)


def is_biotype_family_filter(f: NormalizedFilter) -> bool:
    return f.kind == "alphanumeric" and f.id == FEATURE_BIOTYPE_FAMILY_ID


def is_feature_resource_filter(f: NormalizedFilter) -> bool:
    return f.kind == "alphanumeric" and f.id == FEATURE_RESOURCE_ID


def biotype_family_from_filter(f: NormalizedFilter) -> Optional[str]:
    """Return family key (protein_coding|…) from alphanumeric ``value``."""
    from beacon.biotype_families import BIOTYPE_FAMILY_IDS
    from beacon.filter_display import biotype_family_label

    if not is_biotype_family_filter(f):
        return None
    raw = (f.value or "").strip()
    if not raw:
        return None
    if raw in BIOTYPE_FAMILY_IDS:
        return raw
    for fam in BIOTYPE_FAMILY_IDS:
        if biotype_family_label(fam) == raw:
            return fam
    return None


def feature_resource_stored_from_filter(f: NormalizedFilter) -> Optional[str]:
    """Return lowercase stored resource column value (ncbigene|gencode|…)."""
    if not is_feature_resource_filter(f):
        return None
    raw = (f.value or "").strip()
    if not raw:
        return None
    if raw in FEATURE_RESOURCE_VALUE_TO_STORED:
        return FEATURE_RESOURCE_VALUE_TO_STORED[raw]
    low = raw.lower()
    if low in FEATURE_RESOURCE_VALUE_TO_STORED:
        return FEATURE_RESOURCE_VALUE_TO_STORED[low]
    return low


def is_biosample_preset_filter(f: NormalizedFilter) -> bool:
    return f.kind == "custom" and f.id.startswith(BIOSAMPLE_PRESET_PREFIX)


def is_expression_custom_biosample(f: NormalizedFilter) -> bool:
    """Biosample-axis expression.* custom ids (none currently advertised)."""
    return any(f.id.startswith(p) for p in EXPRESSION_BIOSAMPLE_CUSTOM_PREFIXES)


def is_matrix_only_expression_filter(f: NormalizedFilter) -> bool:
    """Continuous expression.* terms that require a path-bound matrix.

    ``expression.percentile`` is alphanumeric but root-allowed (exempt).
    Cell-level expressionValue terms and median/mean/max remain matrix-only.
    """
    if f.id in EXPRESSION_FEATURE_ROOT_ALLOWED_ALPHANUMERIC:
        return False
    if f.id in (
        EXPRESSION_FEATURE_ALPHANUMERIC
        | EXPRESSION_BIOSAMPLE_ALPHANUMERIC
        | EXPRESSION_VALUE_ALPHANUMERIC
    ):
        return True
    return False


def axis_filter_scope(filt: NormalizedFilter) -> str:
    """Classify a filter for matrix feature/biosample axis routes.

    Returns ``feature``, ``biosample``, ``matrix``, ``expressionValue``, or
    ``unknown``. SO/GO and gene public ids are feature-scoped (same as the
    matrix workspace).
    """
    if filt.kind == "alphanumeric":
        if filt.id in ALPHANUMERIC_FEATURE_FIELDS or filt.id in EXPRESSION_FEATURE_ALPHANUMERIC:
            return "feature"
        if (
            filt.id in ALPHANUMERIC_BIOSAMPLE_FIELDS
            or filt.id in NUMERIC_BIOSAMPLE_FIELDS
            or filt.id in EXPRESSION_BIOSAMPLE_ALPHANUMERIC
        ):
            return "biosample"
        if filt.id in EXPRESSION_VALUE_ALPHANUMERIC:
            return "expressionValue"
        if filt.id in MATRIX_ALPHANUMERIC_FIELDS:
            return "matrix"
        return "unknown"
    if filt.kind == "custom":
        if filt.id.lower().startswith("symbol:"):
            return "feature"
        if is_expression_custom_feature(filt) or is_tissue_feature_filter(filt):
            return "feature"
        if is_biosample_preset_filter(filt) or is_expression_custom_biosample(filt):
            return "biosample"
        if is_matrix_profile_source_filter(filt):
            return "matrix"
        return "unknown"
    if filt.id.startswith("NCBIGene:"):
        return "feature"
    pref = (filt.prefix or _curie_prefix(filt.id) or "").upper().replace("_", "")
    if pref in FEATURE_ONTOLOGY_PREFIXES or pref in GENE_PUBLIC_ID_PREFIXES:
        return "feature"
    if pref == "OBI":
        upper_id = filt.id.upper()
        if filt.id in BIOSAMPLE_OBI_ORIGIN or upper_id in BIOSAMPLE_OBI_ORIGIN:
            return "biosample"
        return "matrix"
    if pref in BIOSAMPLE_ONTOLOGY_PREFIXES:
        return "biosample"
    return "unknown"


def split_matrix_axis_filters(
    filters: Sequence[NormalizedFilter],
) -> Tuple[Optional[Tuple[List[NormalizedFilter], List[NormalizedFilter]]], Optional[str]]:
    """Split mixed axis filters into (feature, biosample).

    Matrix-scoped filters are rejected: they select matrices, not rows inside one.
    """
    feature: List[NormalizedFilter] = []
    biosample: List[NormalizedFilter] = []
    for filt in filters:
        scope = axis_filter_scope(filt)
        if scope == "feature":
            feature.append(filt)
        elif scope == "biosample":
            biosample.append(filt)
        elif scope == "matrix":
            return None, (
                f"matrix-scoped filter {filt.id!r} is not supported on matrix axis endpoints"
            )
        else:
            return None, f"unsupported filter for matrix axis: {filt.id}"
    err = validate_filters_for_entity(feature, entity="feature")
    if err:
        return None, err
    err = validate_filters_for_entity(biosample, entity="biosample")
    if err:
        return None, err
    return (feature, biosample), None


def split_expression_value_filters(
    filters: Sequence[NormalizedFilter],
) -> Tuple[
    Optional[Tuple[List[NormalizedFilter], List[NormalizedFilter], List[NormalizedFilter]]],
    Optional[str],
]:
    """Split filters for ``/matrices/{id}/expression_values`` into
    (feature, biosample, expressionValue) scopes. Matrix-scoped filters are
    rejected: they select matrices, not cells inside one.
    """
    feature: List[NormalizedFilter] = []
    biosample: List[NormalizedFilter] = []
    expr_value: List[NormalizedFilter] = []
    for filt in filters:
        scope = axis_filter_scope(filt)
        if scope == "feature":
            feature.append(filt)
        elif scope == "biosample":
            biosample.append(filt)
        elif scope == "expressionValue":
            expr_value.append(filt)
        elif scope == "matrix":
            return None, (
                f"matrix-scoped filter {filt.id!r} is not supported on expression_values"
            )
        else:
            return None, f"unsupported filter for expression_values: {filt.id}"
    err = validate_filters_for_entity(feature, entity="feature")
    if err:
        return None, err
    err = validate_filters_for_entity(biosample, entity="biosample")
    if err:
        return None, err
    err = validate_filters_for_entity(expr_value, entity="expressionValue")
    if err:
        return None, err
    return (feature, biosample, expr_value), None


def split_feature_matrices_filters(
    filters: Sequence[NormalizedFilter],
) -> Tuple[Optional[Tuple[List[NormalizedFilter], List[NormalizedFilter]]], Optional[str]]:
    """Split filters for ``/features/{id}/matrices`` into (feature, matrix) scopes."""
    feature: List[NormalizedFilter] = []
    matrix: List[NormalizedFilter] = []
    for filt in filters:
        scope = axis_filter_scope(filt)
        if scope == "feature":
            feature.append(filt)
        elif scope == "matrix":
            matrix.append(filt)
        else:
            return None, (
                f"unsupported filter for /features/{{id}}/matrices: {filt.id}"
            )
    err = validate_filters_for_entity(feature, entity="feature")
    if err:
        return None, err
    err = validate_filters_for_entity(matrix, entity="matrix")
    if err:
        return None, err
    return (feature, matrix), None


def split_biosample_matrices_filters(
    filters: Sequence[NormalizedFilter],
) -> Tuple[Optional[Tuple[List[NormalizedFilter], List[NormalizedFilter]]], Optional[str]]:
    """Split filters for ``/biosamples/{id}/matrices`` into (biosample, matrix) scopes."""
    biosample: List[NormalizedFilter] = []
    matrix: List[NormalizedFilter] = []
    for filt in filters:
        scope = axis_filter_scope(filt)
        if scope == "biosample":
            biosample.append(filt)
        elif scope == "matrix":
            matrix.append(filt)
        else:
            return None, (
                f"unsupported filter for /biosamples/{{id}}/matrices: {filt.id}"
            )
    err = validate_filters_for_entity(biosample, entity="biosample")
    if err:
        return None, err
    err = validate_filters_for_entity(matrix, entity="matrix")
    if err:
        return None, err
    return (biosample, matrix), None


def validate_filters_for_entity(
    filters: Sequence[NormalizedFilter], *, entity: str
) -> Optional[str]:
    """Return error message if filters are unsupported for entity, else None."""
    for f in filters:
        if entity == "feature":
            if f.kind == "alphanumeric":
                if f.id in EXPRESSION_FEATURE_ALPHANUMERIC:
                    if f.operator not in ALPHANUMERIC_OPS:
                        return f"unsupported operator for {f.id}: {f.operator}"
                    try:
                        float(f.value)
                    except (TypeError, ValueError):
                        return f"filter {f.id} requires a numeric value"
                    continue
                if f.id not in ALPHANUMERIC_FEATURE_FIELDS:
                    return f"unsupported alphanumeric filter for features: {f.id}"
                if f.operator in (">", "<", ">=", "<="):
                    return (
                        f"operator {f.operator!r} is only supported on numeric biosample fields"
                    )
                if f.id == FEATURE_BIOTYPE_FAMILY_ID:
                    fam = biotype_family_from_filter(f)
                    if not fam:
                        return (
                            f"feature.biotypeFamily requires "
                            f"protein_coding|lncRNA|pseudogene|sncRNA|other "
                            f"(or their display labels): {f.value!r}"
                        )
                    continue
                if f.id == FEATURE_RESOURCE_ID:
                    stored = feature_resource_stored_from_filter(f)
                    if not stored:
                        return "feature.resource requires a non-empty value"
                    continue
                continue
            if f.kind == "custom":
                if is_symbol_custom_filter_id(f.id):
                    if not symbol_id_lookup_key(f.id):
                        return "symbol filter requires a gene symbol after 'symbol:'"
                    continue
                if is_expression_custom_feature(f):
                    err = _validate_expression_custom_value(f.id)
                    if err:
                        return err
                    continue
                if is_tissue_feature_filter(f):
                    err = _validate_tissue_feature_filter(f.id)
                    if err:
                        return err
                    continue
                return f"unsupported custom filter for features: {f.id}"
            # ontology
            pref = (f.prefix or _curie_prefix(f.id) or "").upper().replace("_", "")
            if pref == "NCBIGENE":
                pref = "NCBIGENE"
            if pref not in FEATURE_ONTOLOGY_PREFIXES | GENE_PUBLIC_ID_PREFIXES:
                # allow NCBIGene via NCBIGENE after normalize
                if f.id.startswith("NCBIGene:"):
                    continue
                return f"unsupported ontology filter prefix for features: {f.id}"
        elif entity == "biosample":
            if f.kind == "alphanumeric":
                if f.id in EXPRESSION_BIOSAMPLE_ALPHANUMERIC:
                    if f.operator not in ALPHANUMERIC_OPS:
                        return f"unsupported operator for {f.id}: {f.operator}"
                    try:
                        float(f.value)
                    except (TypeError, ValueError):
                        return f"filter {f.id} requires a numeric value"
                    continue
                if f.id not in ALPHANUMERIC_BIOSAMPLE_FIELDS | NUMERIC_BIOSAMPLE_FIELDS:
                    return f"unsupported alphanumeric filter for biosamples: {f.id}"
                if (
                    f.operator in (">", "<", ">=", "<=")
                    and f.id not in NUMERIC_BIOSAMPLE_FIELDS
                ):
                    return (
                        f"operator {f.operator!r} is only supported on numeric biosample fields"
                    )
                continue
            if f.kind == "custom":
                if is_expression_custom_biosample(f):
                    err = _validate_expression_custom_value(f.id)
                    if err:
                        return err
                    continue
                if f.id not in CUSTOM_BIOSAMPLE_IDS:
                    return f"unsupported custom filter for biosamples: {f.id}"
                continue
            pref = (f.prefix or _curie_prefix(f.id) or "").upper()
            if pref not in BIOSAMPLE_ONTOLOGY_PREFIXES:
                return f"unsupported ontology filter prefix for biosamples: {f.id}"
        elif entity == "expressionValue":
            if f.kind == "alphanumeric" and f.id in EXPRESSION_VALUE_ALPHANUMERIC:
                if f.operator not in ALPHANUMERIC_OPS:
                    return f"unsupported operator for {f.id}: {f.operator}"
                try:
                    float(f.value)
                except (TypeError, ValueError):
                    return f"filter {f.id} requires a numeric value"
                continue
            return f"unsupported filter for expressionValue: {f.id}"
        elif entity == "matrix":
            if f.kind == "alphanumeric":
                if f.id not in MATRIX_ALPHANUMERIC_FIELDS:
                    return f"unsupported alphanumeric filter for matrices: {f.id}"
                continue
            if f.kind == "ontology":
                pref = (f.prefix or _curie_prefix(f.id) or "").upper()
                if pref not in ("OBI", "SO"):
                    return f"unsupported ontology filter prefix for matrices: {f.id}"
                continue
            if f.kind == "custom":
                if is_matrix_profile_source_filter(f):
                    want = matrix_profile_source_filter_value(f.id)
                    if not want:
                        return (
                            f"{MATRIX_PROFILE_SOURCE_ID} requires a value "
                            f"(e.g. {MATRIX_PROFILE_SOURCE_PREFIX}gtex)"
                        )
                    continue
                return f"unsupported custom filter for matrices: {f.id}"
            continue
        else:
            return f"unsupported filter entity: {entity}"
    return None


def _validate_expression_custom_value(fid: str) -> Optional[str]:
    """Light validation for remaining custom filter ids (biosample presets)."""
    if fid.startswith(BIOSAMPLE_PRESET_PREFIX):
        from beacon.expression_filter_maps import parse_biosample_preset

        if parse_biosample_preset(fid) is None:
            return (
                f"biosample.preset requires sex+ontologyId "
                f"(e.g. biosample.preset:female+UBERON:0002048): {fid}"
            )
        return None
    if ":" not in fid:
        return f"malformed expression custom filter: {fid}"
    _, value = fid.split(":", 1)
    if not value.strip():
        return f"expression custom filter {fid!r} requires a value after ':'"
    return None


def _validate_tissue_feature_filter(fid: str) -> Optional[str]:
    from beacon.expression_filter_maps import parse_tissue_feature_filter

    if parse_tissue_feature_filter(fid) is None:
        return (
            f"tissueHigh/tissueSpecific/tissueTop/tissuePresent requires ontologyId "
            f"(e.g. tissueHigh:UBERON:0002107): {fid}"
        )
    return None


def is_gene_public_id_filter(f: NormalizedFilter) -> bool:
    if f.kind != "ontology":
        return False
    if f.id.startswith(("HGNC:", "NCBIGene:", "ENSEMBL:")):
        return True
    pref = (f.prefix or "").upper().replace("_", "")
    return pref in GENE_PUBLIC_ID_PREFIXES


def is_symbol_custom_filter(f: NormalizedFilter) -> bool:
    return f.kind == "custom" and is_symbol_custom_filter_id(f.id)


def symbol_custom_lookup_key(f: NormalizedFilter) -> str:
    """Local part of ``symbol:TP53`` (empty if malformed)."""
    return symbol_id_lookup_key(f.id)


def gene_public_id_lookup_keys(term_id: str) -> List[str]:
    """Expand a gene public-id CURIE into lookup keys (incl. unversioned ENSG)."""
    keys: List[str] = [term_id]
    if ":" not in term_id:
        return keys
    prefix, rest = term_id.split(":", 1)
    pref_u = prefix.upper()
    if pref_u in ("ENSEMBL", "ENSEMBLGENE"):
        keys.extend([rest, f"ENSEMBL:{rest}", f"Ensembl:{rest}"])
        if "." in rest and rest.upper().startswith("ENSG"):
            bare = rest.rsplit(".", 1)[0]
            keys.extend([bare, f"ENSEMBL:{bare}", f"Ensembl:{bare}"])
    # stable unique
    out: List[str] = []
    seen: Set[str] = set()
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def is_so_filter(f: NormalizedFilter) -> bool:
    return f.kind == "ontology" and f.id.startswith("SO:")


def is_go_filter(f: NormalizedFilter) -> bool:
    return f.kind == "ontology" and f.id.startswith("GO:")


def is_feature_ontology_filter(f: NormalizedFilter) -> bool:
    """SO / GO filters on featureType or ontologyTerms."""
    return is_so_filter(f) or is_go_filter(f)


def _biosample_field(doc: Dict[str, Any], field: str) -> Any:
    if field in doc and doc[field] is not None:
        return doc[field]
    info = doc.get("info") or {}
    if isinstance(info, dict) and field in info:
        return info[field]
    return None


def _compare_alphanumeric(
    actual: Any, op: Optional[str], expected: Optional[str]
) -> bool:
    if expected is None:
        return False
    actual_s = "" if actual is None else str(actual)
    if op == "=":
        return actual_s == expected
    if op == "!":
        return actual_s != expected
    return False


def _compare_numeric(actual: Any, op: Optional[str], expected: Optional[str]) -> bool:
    if expected is None or op not in (">", "<", ">=", "<=", "=", "!"):
        return False
    try:
        left = float(actual)
        right = float(expected)
    except (TypeError, ValueError):
        return False
    if op == "=":
        return left == right
    if op == "!":
        return left != right
    if op == ">":
        return left > right
    if op == "<":
        return left < right
    if op == ">=":
        return left >= right
    if op == "<=":
        return left <= right
    return False


def _biosample_ontology_ids(doc: Dict[str, Any]) -> Set[str]:
    ids: Set[str] = set()
    for key in ("sampleOriginDetail", "sampleType", "sampleOriginType", "sampleProcessing"):
        block = doc.get(key) or {}
        if isinstance(block, dict) and block.get("id"):
            ids.add(str(block["id"]))
    status = doc.get("biosampleStatus")
    if isinstance(status, dict) and status.get("id"):
        ids.add(str(status["id"]))
    if doc.get("ontology_id"):
        ids.add(str(doc["ontology_id"]))
    for feat in doc.get("phenotypicFeatures") or []:
        if not isinstance(feat, dict):
            continue
        ft = feat.get("featureType") or {}
        if isinstance(ft, dict) and ft.get("id"):
            ids.add(str(ft["id"]))
        sev = feat.get("severity") or {}
        if isinstance(sev, dict) and sev.get("id"):
            ids.add(str(sev["id"]))
    for meas in doc.get("measurements") or []:
        if not isinstance(meas, dict):
            continue
        code = meas.get("assayCode") or {}
        if isinstance(code, dict) and code.get("id"):
            ids.add(str(code["id"]))
    return ids


def biosample_matches(doc: Dict[str, Any], filters: Sequence[NormalizedFilter]) -> bool:
    for f in filters:
        if f.kind == "alphanumeric" and f.id in NUMERIC_BIOSAMPLE_FIELDS:
            actual = _biosample_field(doc, f.id)
            if not _compare_numeric(actual, f.operator, f.value):
                return False
            continue
        if f.kind == "ontology":
            if f.id not in _biosample_ontology_ids(doc):
                return False
            continue
        return False
    return True


def feature_doc_matches(doc: Dict[str, Any], filters: Sequence[NormalizedFilter]) -> bool:
    """In-memory match for fixture features (gene CURIE filters pre-resolved to ids)."""
    gf = doc
    for f in filters:
        if is_feature_resource_filter(f):
            want = feature_resource_stored_from_filter(f)
            if not want:
                return False
            resource = (gf.get("featureIdentifier") or {}).get("resource")
            if str(resource or "").lower() != want.lower():
                return False
            continue
        if is_symbol_custom_filter(f):
            # Exact case: symbol:Alb and symbol:ALB are distinct filters.
            aliases = [str(a) for a in (gf.get("aliases") or [])]
            sym = symbol_custom_lookup_key(f)
            if not sym:
                return False
            if "%" in sym or "*" in sym:
                pattern = sym.replace("*", "?")
                hit = any(fnmatch.fnmatch(a, pattern) for a in aliases)
            else:
                hit = sym in aliases
            if not hit:
                return False
            continue
        if is_biotype_family_filter(f):
            from beacon.biotype_families import feature_matches_biotype_family

            fam = biotype_family_from_filter(f)
            if not fam:
                return False
            ft = (gf.get("featureType") or {}).get("id")
            biotype = gf.get("biotype") if isinstance(gf.get("biotype"), dict) else {}
            ont_ids = [
                str(t.get("id"))
                for t in (gf.get("ontologyTerms") or [])
                if isinstance(t, dict) and t.get("id")
            ]
            if biotype.get("id"):
                ont_ids = [str(biotype["id"])] + ont_ids
            if not feature_matches_biotype_family(
                fam, feature_type_id=str(ft) if ft else None, ontology_term_ids=ont_ids
            ):
                return False
            continue
        if f.kind == "alphanumeric" and f.id in EXPRESSION_FEATURE_ALPHANUMERIC:
            info = doc.get("info") if isinstance(doc.get("info"), dict) else {}
            col = {
                "expression.median": "median",
                "expression.mean": "mean",
                "expression.max": "max_value",
                "expression.percentile": "median_percentile",
            }[f.id]
            actual = doc.get(col)
            if actual is None:
                actual = info.get(col)
            if not _compare_numeric(actual, f.operator, f.value):
                return False
            continue
        if f.kind == "custom" and is_expression_custom_feature(f):
            return False
        if is_tissue_feature_filter(f):
            # Fixture docs may carry tissueBands / tissueLevels / legacy highs.
            info = doc.get("info") if isinstance(doc.get("info"), dict) else {}
            parsed = None
            try:
                from beacon.expression_filter_maps import parse_tissue_feature_filter

                parsed = parse_tissue_feature_filter(f.id)
            except Exception:
                parsed = None
            if parsed is None:
                return False
            kind, oid = parsed
            oid_u = oid.upper()
            bands_raw = info.get("tissueBands") or {}
            band_val: Optional[int] = None
            if isinstance(bands_raw, dict):
                for k, v in bands_raw.items():
                    if str(k).upper() == oid_u:
                        try:
                            band_val = int(v)
                        except (TypeError, ValueError):
                            band_val = None
                        break
            if kind == "top":
                if band_val == 99:
                    continue
                return False
            if kind == "present" and band_val is not None:
                continue
            levels_raw = info.get("tissueLevels") or {}
            levels: Dict[str, int] = {}
            if isinstance(levels_raw, dict):
                for k, v in levels_raw.items():
                    try:
                        levels[str(k).upper()] = int(v)
                    except (TypeError, ValueError):
                        continue
            if levels:
                lvl = levels.get(oid_u)
                if kind == "present":
                    if lvl is None:
                        return False
                    continue
                if kind == "high":
                    if lvl is None or lvl < 1:
                        return False
                    continue
                if lvl != 2:
                    return False
                continue
            highs = {
                str(x).upper()
                for x in (info.get("tissueHighOntologyIds") or [])
                if x
            }
            if kind == "present":
                # Legacy fixtures only listed highs; treat as present.
                if oid_u not in highs:
                    return False
                continue
            if kind == "high":
                if oid_u not in highs:
                    return False
                continue
            # specific (legacy): high in oid and not high in any other listed tissue
            if oid_u not in highs:
                return False
            if any(other != oid_u for other in highs):
                return False
            continue
        if is_feature_ontology_filter(f):
            ft = (gf.get("featureType") or {}).get("id")
            biotype = gf.get("biotype") if isinstance(gf.get("biotype"), dict) else {}
            ont_ids = {
                str(t.get("id"))
                for t in (gf.get("ontologyTerms") or [])
                if isinstance(t, dict) and t.get("id")
            }
            if biotype.get("id"):
                ont_ids.add(str(biotype["id"]))
            if f.id != str(ft) and f.id not in ont_ids:
                return False
            continue
        if is_gene_public_id_filter(f):
            # Match xrefs or native Ensembl gene id (incl. unversioned CURIE keys)
            keys = {k.upper() for k in gene_public_id_lookup_keys(f.id)}
            xrefs = {str(x).upper() for x in (gf.get("xrefs") or [])}
            native = str((gf.get("featureIdentifier") or {}).get("id") or "")
            native_u = native.upper()
            native_bare = native_u.rsplit(".", 1)[0] if "." in native_u else native_u
            if not (keys & xrefs or native_u in keys or native_bare in keys):
                return False
            continue
        return False
    return True


def matrix_matches(
    doc: Dict[str, Any],
    filters: Sequence[NormalizedFilter],
    *,
    extra_ontology_ids: Optional[Set[str]] = None,
) -> bool:
    """Match matrix metadata filters.

    Ontology ids are taken from ``assayType``, ``featureTypes``, ``biotypes``,
    and optional ``extra_ontology_ids`` (e.g. SO ids present on the matrix's
    feature rows so biotype SO filters work on ``GET /matrices``).
    """
    for f in filters:
        if f.kind == "ontology":
            assay = doc.get("assayType") or {}
            ft = doc.get("featureTypes")
            if ft is None:
                ft = doc.get("featureType") or []
            ids = set()
            if isinstance(assay, dict) and assay.get("id"):
                ids.add(str(assay["id"]))
            if isinstance(ft, list):
                for item in ft:
                    if isinstance(item, dict) and item.get("id"):
                        ids.add(str(item["id"]))
            for item in doc.get("biotypes") or []:
                if isinstance(item, dict) and item.get("id"):
                    ids.add(str(item["id"]))
            if extra_ontology_ids:
                ids.update(extra_ontology_ids)
            if f.id not in ids:
                return False
            continue
        if f.kind == "alphanumeric":
            val = f.value
            if f.id == "matrix.unit":
                actual = (doc.get("expressionUnitAndScale") or {}).get("unit")
            elif f.id == "matrix.scale":
                actual = (doc.get("expressionUnitAndScale") or {}).get("scale")
            elif f.id == "matrix.annotation":
                ann = doc.get("annotation") or {}
                actual = matrix_annotation_filter_value(
                    ann.get("source"), ann.get("version")
                )
            elif f.id == "matrix.annotation.source":
                actual = (doc.get("annotation") or {}).get("source")
            elif f.id == "matrix.annotation.version":
                actual = (doc.get("annotation") or {}).get("version")
            elif f.id == "matrix.assembly.name":
                actual = (doc.get("assembly") or {}).get("name")
            elif f.id == "matrix.reproducible":
                actual = doc.get("reproducible")
                val = str(val).lower() in ("1", "true", "yes")
            else:
                return False
            if f.id == "matrix.reproducible":
                if f.operator == "=" and bool(actual) != bool(val):
                    return False
                if f.operator == "!" and bool(actual) == bool(val):
                    return False
            elif not _compare_alphanumeric(actual, f.operator, val):
                return False
            continue
        if is_matrix_profile_source_filter(f):
            want = matrix_profile_source_filter_value(f.id)
            if not want:
                return False
            actual = matrix_profile_source(doc)
            if str(actual or "").strip().lower() != want.lower():
                return False
            continue
        return False
    return True


def filters_to_summary(filters: Sequence[NormalizedFilter]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for f in filters:
        d: Dict[str, Any] = {"id": f.id}
        if f.kind == "alphanumeric":
            d["operator"] = f.operator
            d["value"] = f.value
        elif f.kind == "ontology":
            # No ontology closure is shipped; matching is the term id only.
            d["includeDescendantTerms"] = False
            d["similarity"] = "exact"
        if f.scope:
            d["scope"] = f.scope
        out.append(d)
    return out
