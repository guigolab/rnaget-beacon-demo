"""Matrix-scoped filtering_terms for axis query bars."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Sequence, Set, Tuple

AxisKind = Literal["features", "biosamples"]


def _ids_from_feature_row(row: Dict[str, Any]) -> Set[str]:
    ids: Set[str] = set()
    fi = row.get("featureIdentifier") or {}
    if fi.get("id"):
        ids.add(str(fi["id"]))
    ft = row.get("featureType") or {}
    if isinstance(ft, dict) and ft.get("id"):
        ids.add(str(ft["id"]))
    for ot in row.get("ontologyTerms") or []:
        if isinstance(ot, dict) and ot.get("id"):
            ids.add(str(ot["id"]))
    for xref in row.get("xrefs") or []:
        if xref:
            ids.add(str(xref))
    for alias in row.get("aliases") or []:
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


def _matrix_catalog_term_ids(
    matrix: Optional[Dict[str, Any]], key: str, *, legacy_key: Optional[str] = None
) -> Set[str]:
    ids: Set[str] = set()
    if not matrix:
        return ids
    raw = matrix.get(key)
    if raw is None and legacy_key:
        raw = matrix.get(legacy_key) or []
    for ft in raw or []:
        if isinstance(ft, dict) and ft.get("id"):
            ids.add(str(ft["id"]))
    return ids


def _matrix_feature_type_ids(matrix: Optional[Dict[str, Any]]) -> Set[str]:
    return _matrix_catalog_term_ids(matrix, "featureTypes", legacy_key="featureType")


def _matrix_catalog_terms(
    matrix: Optional[Dict[str, Any]], key: str, *, legacy_key: Optional[str] = None
) -> List[Dict[str, str]]:
    """Ontology terms from a matrix catalog list (featureTypes / biotypes / …)."""
    out: List[Dict[str, str]] = []
    if not matrix:
        return out
    raw = matrix.get(key)
    if raw is None and legacy_key:
        raw = matrix.get(legacy_key) or []
    seen: Set[str] = set()
    for ft in raw or []:
        if not isinstance(ft, dict) or not ft.get("id"):
            continue
        tid = str(ft["id"])
        k = tid.lower()
        if k in seen:
            continue
        seen.add(k)
        term: Dict[str, str] = {"id": tid}
        if ft.get("label"):
            term["label"] = str(ft["label"])
        out.append(term)
    return out


def _matrix_feature_type_terms(matrix: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Ontology terms from matrix.featureTypes (post sync_matrix_feature_types)."""
    return _matrix_catalog_terms(matrix, "featureTypes", legacy_key="featureType")


def ensure_matrix_feature_so_terms(
    terms: Sequence[Dict[str, Any]],
    resources: Sequence[Dict[str, Any]],
    *,
    matrix: Optional[Dict[str, Any]],
    present_ids: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Guarantee Sequence Ontology classes for this matrix appear under genomicFeature.

    Sources (union):
    - ``matrix.featureTypes`` / ``matrix.biotypes`` (package sync from hydrated rows)
    - ``SO:*`` ids already observed in ``present_ids``
      (row feature_type_id / biotype_id / ontologyTerms)

    Synthesizes catalog entries when the global filtering_terms subset omitted them.
    """
    out = [dict(t) for t in terms]
    existing = {str(t.get("id") or "").lower() for t in out if t.get("id")}

    candidates: Dict[str, Optional[str]] = {}
    for ft in _matrix_feature_type_terms(matrix):
        tid = ft["id"]
        if not tid.upper().startswith("SO:"):
            continue
        candidates[tid] = ft.get("label")
    for ft in _matrix_catalog_terms(matrix, "biotypes"):
        tid = ft["id"]
        if not tid.upper().startswith("SO:"):
            continue
        candidates.setdefault(tid, ft.get("label"))
    for pid in present_ids or ():
        s = str(pid)
        if not s.upper().startswith("SO:"):
            continue
        candidates.setdefault(s, None)

    from beacon.filter_display import so_display_label

    for tid in sorted(candidates, key=lambda x: x.upper()):
        key = tid.lower()
        if key in existing:
            # Refresh display label when we synthesize/ensure terms.
            for term in out:
                if str(term.get("id") or "").lower() == key:
                    term["label"] = so_display_label(
                        term.get("label") or candidates[tid], fallback_id=tid
                    )
                    break
            continue
        label = candidates[tid]
        entry: Dict[str, Any] = {
            "type": "SO",
            "id": tid,
            "scopes": ["genomicFeature"],
            "label": so_display_label(label, fallback_id=tid),
        }
        out.append(entry)
        existing.add(key)

    resources_out = list(resources)
    has_so = any(
        str(r.get("id") or "").lower() == "so"
        or str(r.get("nameSpacePrefix") or "").upper() == "SO"
        for r in resources_out
    )
    if not has_so and any(str(t.get("id") or "").upper().startswith("SO:") for t in out):
        resources_out.append(
            {
                "id": "so",
                "name": "Sequence Ontology",
                "nameSpacePrefix": "SO",
                "iriPrefix": "http://purl.obolibrary.org/obo/SO_",
                "url": "http://purl.obolibrary.org/obo/so.obo",
            }
        )
    return out, resources_out


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
        if tid == "feature.resource":
            keep_ids.update({"ncbigene", "ensembl", "gencode"})
    keep_ids.update(
        {"hgnc", "ncbigene", "ensembl", "symbol", "so", "uberon", "efo", "go"}
    )
    return [
        r
        for r in resources
        if str(r.get("id") or "").lower() in keep_ids
        or str(r.get("nameSpacePrefix") or "").lower() in keep_ids
    ]


def _sex_ontology_pair_from_biosample_row(
    row: Dict[str, Any],
) -> Optional[Tuple[str, str]]:
    """Same-row (sex_lower, ontology_id) when both are present on the row."""
    sex = row.get("sex")
    if not sex or not str(sex).strip():
        return None
    sex_l = str(sex).strip().lower()
    oid = None
    # Prefer explicit ontology_id / info tissue id when present (parquet shape).
    for key in ("ontology_id", "ontologyId"):
        raw = row.get(key)
        if raw and str(raw).strip():
            oid = str(raw).strip()
            break
    if oid is None:
        for pf in row.get("phenotypicFeatures") or []:
            if not isinstance(pf, dict):
                continue
            ft = pf.get("featureType") or {}
            if isinstance(ft, dict) and ft.get("id"):
                oid = str(ft["id"]).strip()
                break
    if not oid:
        return None
    return sex_l, oid


def _subset_terms(
    global_terms: Sequence[Dict[str, Any]],
    global_resources: Sequence[Dict[str, Any]],
    *,
    present_ids: Set[str],
    alphanumeric: Dict[str, Set[str]],
    scope: str,
    keep_symbol_resource: bool = False,
    sex_ontology_pairs: Optional[Set[Tuple[str, str]]] = None,
    allowed_expression_ids: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    present_lower = {x.lower() for x in present_ids}
    # sex_ontology_pairs kept for call-site compatibility; presets are not catalogued.
    _ = sex_ontology_pairs
    out: List[Dict[str, Any]] = []

    for term in global_terms:
        scopes = term.get("scopes") or []
        if scope not in scopes:
            continue
        tid = str(term.get("id") or "")
        typ = str(term.get("type") or "")

        # Catalog type may be custom (not a genomicFeature schema field) while
        # request wire stays alphanumeric. Handle before typ branching.
        if tid == "expression.percentile":
            # Root-advertised with values; keep only when this matrix's
            # allow-list includes it, intersecting observed chip values.
            if (
                allowed_expression_ids is None
                or tid not in allowed_expression_ids
            ):
                continue
            observed = alphanumeric.get(tid) or set()
            catalog_values = term.get("values") or []
            if catalog_values and observed:
                intersected = [v for v in catalog_values if v in observed]
                if not intersected:
                    continue
                copy = dict(term)
                copy["values"] = intersected
                out.append(copy)
            elif observed:
                copy = dict(term)
                copy["values"] = sorted(
                    observed, key=lambda x: int(x) if str(x).isdigit() else 0
                )
                out.append(copy)
            else:
                out.append(dict(term))
            continue

        if tid == "feature.biotypeFamily":
            from beacon.biotype_families import families_present_in

            present_fams = families_present_in(present_ids)
            catalog_values = [
                v for v in (term.get("values") or []) if v in present_fams
            ]
            if not catalog_values:
                continue
            copy = dict(term)
            copy["values"] = catalog_values
            out.append(copy)
            continue

        if typ == "alphanumeric":
            # Dropped from catalogs (still matchable via API if sent).
            if tid in ("matrix.scale", "matrix.reproducible"):
                continue
            # Other continuous expression.* fields (median/mean/max/value/…)
            # have no enumerated values; keep when the scope matches.
            if tid.startswith("expression."):
                out.append(dict(term))
                continue
            if tid == "feature.resource":
                # Keep GenCode + NCBI Gene whenever the matrix has feature rows;
                # matching still equals the stored resource column.
                from beacon.filters import FEATURE_RESOURCE_CATALOG_VALUES

                copy = dict(term)
                copy["values"] = list(FEATURE_RESOURCE_CATALOG_VALUES)
                out.append(copy)
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

        # Categorical expression.* customs: only keep ids this matrix supports.
        # When allowed_expression_ids is None (live fallback), drop them so we
        # never advertise another matrix's bands/profiles/enriched_in terms.
        if tid.startswith("expression."):
            if allowed_expression_ids is not None and tid in allowed_expression_ids:
                out.append(dict(term))
            continue

        # biosample.preset / tissueHigh / tissueSpecific are not catalogued.
        if tid.startswith("biosample.preset:"):
            continue
        if tid.startswith("tissueHigh:") or tid.startswith("tissueSpecific:"):
            continue

        if tid.lower() in present_lower:
            out.append(dict(term))
            continue

        if typ in ("SO", "GO", "UBERON", "EFO", "OBI", "MONDO", "HP", "NCIT", "custom"):
            if typ in ("GO", "MONDO", "HP", "NCIT", "OBI") and scope == "biosample":
                continue
            if typ == "EFO" and scope == "biosample":
                from beacon.filter_display import is_biosample_catalog_ontology_id

                if not is_biosample_catalog_ontology_id(tid):
                    continue
            if any(pid.lower() == tid.lower() for pid in present_ids):
                out.append(dict(term))

    resources = _prune_resources(out, global_resources)
    if keep_symbol_resource:
        resources_by_id = {
            str(r.get("id") or "").lower(): dict(r) for r in resources if r.get("id")
        }
        for r in global_resources:
            rid = str(r.get("id") or "").lower()
            prefix = str(r.get("nameSpacePrefix") or "").lower()
            if rid == "symbol" or prefix == "symbol":
                resources_by_id[rid or "symbol"] = dict(r)
        resources = list(resources_by_id.values())
    return out, resources


def build_matrix_features_filtering_terms(
    features: Sequence[Dict[str, Any]],
    matrix: Optional[Dict[str, Any]],
    global_terms: Sequence[Dict[str, Any]],
    global_resources: Sequence[Dict[str, Any]],
    *,
    allowed_expression_ids: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    present: Set[str] = set()
    present.update(_matrix_feature_type_ids(matrix))
    for row in features:
        present.update(_ids_from_feature_row(row))

    terms, resources = _subset_terms(
        global_terms,
        global_resources,
        present_ids=present,
        alphanumeric={},
        scope="genomicFeature",
        keep_symbol_resource=bool(features),
        allowed_expression_ids=allowed_expression_ids,
    )
    return ensure_matrix_feature_so_terms(
        terms, resources, matrix=matrix, present_ids=present
    )


def build_matrix_biosamples_filtering_terms(
    biosamples: Sequence[Dict[str, Any]],
    global_terms: Sequence[Dict[str, Any]],
    global_resources: Sequence[Dict[str, Any]],
    *,
    allowed_expression_ids: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    present: Set[str] = set()
    alphanumeric: Dict[str, Set[str]] = {}
    pairs: Set[Tuple[str, str]] = set()
    for row in biosamples:
        present.update(_ids_from_biosample_row(row))
        for field, values in _biosample_alphanumeric(row).items():
            alphanumeric.setdefault(field, set()).update(values)
        pair = _sex_ontology_pair_from_biosample_row(row)
        if pair:
            pairs.add(pair)

    return _subset_terms(
        global_terms,
        global_resources,
        present_ids=present,
        alphanumeric=alphanumeric,
        scope="biosample",
        keep_symbol_resource=False,
        sex_ontology_pairs=pairs,
        allowed_expression_ids=allowed_expression_ids,
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


def merge_matrix_scoped_filtering_terms(
    feature_terms: Sequence[Dict[str, Any]],
    feature_resources: Sequence[Dict[str, Any]],
    biosample_terms: Sequence[Dict[str, Any]],
    biosample_resources: Sequence[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Combine feature + biosample axis catalogs for /matrices/{id}/filtering_terms."""
    from beacon.matrix_catalog_seed import merge_filtering_terms

    terms = merge_filtering_terms(list(feature_terms), list(biosample_terms))
    resources_by_id: Dict[str, Dict[str, Any]] = {}
    for resource in (*feature_resources, *biosample_resources):
        rid = str(resource.get("id") or "")
        if rid:
            resources_by_id[rid] = dict(resource)
    resources = _prune_resources(terms, list(resources_by_id.values()))
    return terms, resources
