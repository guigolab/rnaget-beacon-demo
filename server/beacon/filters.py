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
ALPHANUMERIC_FEATURE_FIELDS = frozenset({"genomicFeature.symbol"})
ALPHANUMERIC_BIOSAMPLE_FIELDS = frozenset(
    {"sex", "age_bracket", "condition", "timepoint"}
)
NUMERIC_BIOSAMPLE_FIELDS = frozenset({"rin", "ischemic_time_min"})
MATRIX_ALPHANUMERIC_FIELDS = frozenset(
    {
        "matrix.unit",
        "matrix.scale",
        "matrix.annotation.source",
        "matrix.annotation.version",
        "matrix.assembly.name",
        "matrix.reproducible",
        "matrix.profileSource",
    }
)
CUSTOM_BIOSAMPLE_IDS: frozenset[str] = frozenset()
ALPHANUMERIC_OPS = frozenset({"=", "!", "<", ">", "<=", ">="})


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
        ):
            raise ValueError(
                f"alphanumeric filter {fid!r} requires operator and value"
            )
        if fid.startswith("resource:") or fid in CUSTOM_BIOSAMPLE_IDS:
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


def axis_filter_scope(filt: NormalizedFilter) -> str:
    """Classify a filter for matrix feature/biosample axis routes.

    Returns ``feature``, ``biosample``, ``matrix``, or ``unknown``.
    SO/GO and gene public ids are feature-scoped (same as the matrix workspace).
    """
    if filt.kind == "alphanumeric":
        if filt.id in ALPHANUMERIC_FEATURE_FIELDS:
            return "feature"
        if filt.id in ALPHANUMERIC_BIOSAMPLE_FIELDS or filt.id in NUMERIC_BIOSAMPLE_FIELDS:
            return "biosample"
        if filt.id in MATRIX_ALPHANUMERIC_FIELDS:
            return "matrix"
        return "unknown"
    if filt.kind == "custom":
        if filt.id.startswith("resource:"):
            return "feature"
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


def validate_filters_for_entity(
    filters: Sequence[NormalizedFilter], *, entity: str
) -> Optional[str]:
    """Return error message if filters are unsupported for entity, else None."""
    for f in filters:
        if entity == "feature":
            if f.kind == "alphanumeric":
                if f.id not in ALPHANUMERIC_FEATURE_FIELDS:
                    return f"unsupported alphanumeric filter for features: {f.id}"
                if f.operator in (">", "<", ">=", "<="):
                    return (
                        f"operator {f.operator!r} is only supported on numeric biosample fields"
                    )
                continue
            if f.kind == "custom":
                if not f.id.startswith("resource:"):
                    return f"unsupported custom filter for features: {f.id}"
                continue
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
                if f.id not in CUSTOM_BIOSAMPLE_IDS:
                    return f"unsupported custom filter for biosamples: {f.id}"
                continue
            pref = (f.prefix or _curie_prefix(f.id) or "").upper()
            if pref not in BIOSAMPLE_ONTOLOGY_PREFIXES:
                return f"unsupported ontology filter prefix for biosamples: {f.id}"
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
                return f"unsupported custom filter for matrices: {f.id}"
            continue
        else:
            return f"unsupported filter entity: {entity}"
    return None


def is_gene_public_id_filter(f: NormalizedFilter) -> bool:
    if f.kind != "ontology":
        return False
    if f.id.startswith(("HGNC:", "NCBIGene:", "ENSEMBL:")):
        return True
    pref = (f.prefix or "").upper().replace("_", "")
    return pref in GENE_PUBLIC_ID_PREFIXES


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
        if f.kind == "alphanumeric" and f.id in ALPHANUMERIC_BIOSAMPLE_FIELDS:
            actual = _biosample_field(doc, f.id if f.id != "sex" else "sex")
            if not _compare_alphanumeric(actual, f.operator, f.value):
                return False
            continue
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
    gf = doc.get("genomicFeature") or {}
    for f in filters:
        if f.kind == "custom" and f.id.startswith("resource:"):
            want = f.id.split(":", 1)[1]
            resource = (gf.get("featureIdentifier") or {}).get("resource")
            if str(resource) != want:
                return False
            continue
        if f.kind == "alphanumeric" and f.id == "genomicFeature.symbol":
            aliases = [str(a).upper() for a in (gf.get("aliases") or [])]
            sym = (f.value or "").upper()
            if "%" in sym or "*" in sym:
                pattern = sym.replace("*", "?")
                hit = any(fnmatch.fnmatch(a, pattern) for a in aliases)
            else:
                hit = sym in aliases
            if f.operator == "=" and not hit:
                return False
            if f.operator == "!" and hit:
                return False
            continue
        if is_feature_ontology_filter(f):
            ft = (gf.get("featureType") or {}).get("id")
            ont_ids = {
                str(t.get("id"))
                for t in (gf.get("ontologyTerms") or [])
                if isinstance(t, dict) and t.get("id")
            }
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


def matrix_matches(doc: Dict[str, Any], filters: Sequence[NormalizedFilter]) -> bool:
    for f in filters:
        if f.kind == "ontology":
            assay = doc.get("assayType") or {}
            ft = doc.get("featureType") or []
            ids = set()
            if isinstance(assay, dict) and assay.get("id"):
                ids.add(str(assay["id"]))
            if isinstance(ft, list):
                for item in ft:
                    if isinstance(item, dict) and item.get("id"):
                        ids.add(str(item["id"]))
            if f.id not in ids:
                return False
            continue
        if f.kind == "alphanumeric":
            val = f.value
            if f.id == "matrix.unit":
                actual = (doc.get("expressionUnitAndScale") or {}).get("unit")
            elif f.id == "matrix.scale":
                actual = (doc.get("expressionUnitAndScale") or {}).get("scale")
            elif f.id == "matrix.annotation.source":
                actual = (doc.get("annotation") or {}).get("source")
            elif f.id == "matrix.annotation.version":
                actual = (doc.get("annotation") or {}).get("version")
            elif f.id == "matrix.assembly.name":
                actual = (doc.get("assembly") or {}).get("name")
            elif f.id == "matrix.reproducible":
                actual = doc.get("reproducible")
                val = str(val).lower() in ("1", "true", "yes")
            elif f.id == "matrix.profileSource":
                info = doc.get("info") or {}
                actual = info.get("profileSource") or info.get("catalogSource")
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
