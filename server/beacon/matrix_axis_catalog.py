"""Matrix-scoped filtering_terms for heatmap axis query bars."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Sequence, Set, Tuple

AxisKind = Literal["features", "biosamples"]


def _ids_from_feature_row(row: Dict[str, Any]) -> Set[str]:
    ids: Set[str] = set()
    gf = row.get("genomicFeature") or {}
    fi = gf.get("featureIdentifier") or {}
    if fi.get("id"):
        ids.add(str(fi["id"]))
    ft = gf.get("featureType") or {}
    if isinstance(ft, dict) and ft.get("id"):
        ids.add(str(ft["id"]))
    for ot in gf.get("ontologyTerms") or []:
        if isinstance(ot, dict) and ot.get("id"):
            ids.add(str(ot["id"]))
    for xref in gf.get("xrefs") or []:
        if xref:
            ids.add(str(xref))
    for alias in gf.get("aliases") or []:
        if alias:
            ids.add(str(alias).upper())
    return ids


def _ids_from_biosample_row(row: Dict[str, Any]) -> Set[str]:
    ids: Set[str] = set()
    for key in (
        "biosampleStatus",
        "sampleOriginType",
        "sampleOriginDetail",
        "sampleProcessing",
    ):
        obj = row.get(key)
        if isinstance(obj, dict) and obj.get("id"):
            ids.add(str(obj["id"]))
    for pf in row.get("phenotypicFeatures") or []:
        if not isinstance(pf, dict):
            continue
        ft = pf.get("featureType") or {}
        if isinstance(ft, dict) and ft.get("id"):
            ids.add(str(ft["id"]))
        sev = pf.get("severity") or {}
        if isinstance(sev, dict) and sev.get("id"):
            ids.add(str(sev["id"]))
    for meas in row.get("measurements") or []:
        if not isinstance(meas, dict):
            continue
        assay = meas.get("assayCode") or {}
        if isinstance(assay, dict) and assay.get("id"):
            ids.add(str(assay["id"]))
    return ids


def _biosample_alphanumeric(row: Dict[str, Any]) -> Dict[str, Set[str]]:
    out: Dict[str, Set[str]] = {}
    if row.get("sex"):
        out.setdefault("sex", set()).add(str(row["sex"]))
    info = row.get("info") or {}
    if isinstance(info, dict):
        for key in ("condition", "age_bracket", "tissue"):
            val = info.get(key)
            if val is not None and str(val).strip():
                out.setdefault(key, set()).add(str(val))
    return out


def _matrix_feature_type_ids(matrix: Optional[Dict[str, Any]]) -> Set[str]:
    ids: Set[str] = set()
    if not matrix:
        return ids
    for ft in matrix.get("featureType") or []:
        if isinstance(ft, dict) and ft.get("id"):
            ids.add(str(ft["id"]))
    return ids


def _prune_resources(
    terms: Sequence[Dict[str, Any]], resources: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    keep_ids: Set[str] = set()
    for term in terms:
        tid = str(term.get("id") or "")
        if ":" in tid:
            keep_ids.add(tid.split(":", 1)[0].lower())
        typ = str(term.get("type") or "").lower()
        if typ in ("so", "uberon", "efo", "go", "obi", "mondo", "hp", "ncit"):
            keep_ids.add(typ)
        if term.get("type") == "custom" and tid.lower().startswith("resource:"):
            keep_ids.add(tid.split(":", 1)[-1].lower())
    keep_ids.update({"hgnc", "ncbigene", "ensembl", "so", "uberon", "efo", "go"})
    return [
        r
        for r in resources
        if str(r.get("id") or "").lower() in keep_ids
        or str(r.get("nameSpacePrefix") or "").lower() in keep_ids
    ]


def _subset_terms(
    global_terms: Sequence[Dict[str, Any]],
    global_resources: Sequence[Dict[str, Any]],
    *,
    present_ids: Set[str],
    alphanumeric: Dict[str, Set[str]],
    scope: str,
    keep_symbol_term: bool,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    present_lower = {x.lower() for x in present_ids}
    out: List[Dict[str, Any]] = []

    for term in global_terms:
        scopes = term.get("scopes") or []
        if scope not in scopes:
            continue
        tid = str(term.get("id") or "")
        typ = str(term.get("type") or "")

        if typ == "alphanumeric":
            if tid == "genomicFeature.symbol" and keep_symbol_term:
                out.append(dict(term))
                continue
            observed = alphanumeric.get(tid) or set()
            catalog_values = term.get("values") or []
            if catalog_values:
                intersected = sorted(
                    v for v in catalog_values if v in observed
                )
                if not intersected:
                    continue
                copy = dict(term)
                copy["values"] = intersected
                out.append(copy)
            elif observed:
                copy = dict(term)
                copy["values"] = sorted(observed)
                out.append(copy)
            continue

        if tid.lower() in present_lower:
            out.append(dict(term))
            continue

        if typ in ("SO", "GO", "UBERON", "EFO", "OBI", "MONDO", "HP", "NCIT", "custom"):
            if any(pid.lower() == tid.lower() for pid in present_ids):
                out.append(dict(term))

    resources = _prune_resources(out, global_resources)
    return out, resources


def build_matrix_features_filtering_terms(
    features: Sequence[Dict[str, Any]],
    matrix: Optional[Dict[str, Any]],
    global_terms: Sequence[Dict[str, Any]],
    global_resources: Sequence[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    present: Set[str] = set()
    present.update(_matrix_feature_type_ids(matrix))
    for row in features:
        present.update(_ids_from_feature_row(row))

    return _subset_terms(
        global_terms,
        global_resources,
        present_ids=present,
        alphanumeric={},
        scope="genomicFeature",
        keep_symbol_term=bool(features),
    )


def build_matrix_biosamples_filtering_terms(
    biosamples: Sequence[Dict[str, Any]],
    global_terms: Sequence[Dict[str, Any]],
    global_resources: Sequence[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    present: Set[str] = set()
    alphanumeric: Dict[str, Set[str]] = {}
    for row in biosamples:
        present.update(_ids_from_biosample_row(row))
        for field, values in _biosample_alphanumeric(row).items():
            alphanumeric.setdefault(field, set()).update(values)

    return _subset_terms(
        global_terms,
        global_resources,
        present_ids=present,
        alphanumeric=alphanumeric,
        scope="biosample",
        keep_symbol_term=False,
    )


def build_matrix_axis_filtering_terms(
    axis: AxisKind,
    *,
    features: Sequence[Dict[str, Any]],
    biosamples: Sequence[Dict[str, Any]],
    matrix: Optional[Dict[str, Any]],
    global_terms: Sequence[Dict[str, Any]],
    global_resources: Sequence[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if axis == "features":
        return build_matrix_features_filtering_terms(
            features, matrix, global_terms, global_resources
        )
    return build_matrix_biosamples_filtering_terms(
        biosamples, global_terms, global_resources
    )
