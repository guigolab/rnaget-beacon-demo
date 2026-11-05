"""Matrix catalog filtering and filtering_terms for the demo Beacon."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Set

from beacon.filters import (
    matrix_annotation_filter_value,
    matrix_matches,
    matrix_profile_source,
)
from beacon.matrix_catalog_seed import load_matrix_seed_terms, merge_filtering_terms

# Beacon matrix defaultSchema properties only (no info / packaging extras).
MATRIX_SCHEMA_KEYS = frozenset(
    {
        "matrixId",
        "createDateTime",
        "description",
        "downloadUrl",
        "reproducible",
        "assayType",
        "name",
        "dimensions",
        "featureTypes",
        "expressionUnitAndScale",
        "expressionValueRange",
        "annotation",
        "assembly",
    }
)


def public_matrix_doc(matrix: Dict[str, Any]) -> Dict[str, Any]:
    """Return a schema-true matrix document for API responses."""
    return {
        key: matrix[key]
        for key in MATRIX_SCHEMA_KEYS
        if key in matrix and matrix[key] is not None
    }


def list_matrices_filtered(
    matrices: Sequence[Dict[str, Any]],
    filters: Optional[Sequence[Any]],
    *,
    extra_ontology_ids_by_matrix: Optional[Dict[str, Set[str]]] = None,
) -> List[Dict[str, Any]]:
    if not filters:
        return list(matrices)
    extra_map = extra_ontology_ids_by_matrix or {}
    out: List[Dict[str, Any]] = []
    for m in matrices:
        mid = str(m.get("matrixId") or m.get("id") or "")
        extra = extra_map.get(mid)
        if matrix_matches(m, filters, extra_ontology_ids=extra):
            out.append(m)
    return out


def build_matrix_filtering_terms(
    matrices: Sequence[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Facet catalog for matrix-scoped terms on root /filtering_terms."""
    units: Set[str] = set()
    annotations: Set[str] = set()
    assemblies: Set[str] = set()
    profile_sources: Set[str] = set()
    assay_terms: Dict[str, str] = {}
    feature_types: Dict[str, str] = {}

    for m in matrices:
        uas = m.get("expressionUnitAndScale") or {}
        if uas.get("unit"):
            units.add(str(uas["unit"]))
        ann = m.get("annotation") or {}
        merged = matrix_annotation_filter_value(ann.get("source"), ann.get("version"))
        if merged:
            annotations.add(merged)
        asm = m.get("assembly") or {}
        if asm.get("name"):
            assemblies.add(str(asm["name"]))
        ps = matrix_profile_source(m)
        if ps:
            profile_sources.add(ps)
        assay = m.get("assayType") or {}
        if isinstance(assay, dict) and assay.get("id"):
            assay_terms[str(assay["id"])] = str(assay.get("label") or assay["id"])
        raw_ft = m.get("featureTypes")
        if raw_ft is None:
            raw_ft = m.get("featureType") or []
        for ft in raw_ft or []:
            if isinstance(ft, dict) and ft.get("id"):
                feature_types[str(ft["id"])] = str(ft.get("label") or ft["id"])

    terms: List[Dict[str, Any]] = []
    from beacon.filter_display import (
        matrix_annotation_label,
        matrix_assembly_label,
        matrix_profile_source_label,
        matrix_unit_label,
        so_display_label,
    )

    if units:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.unit",
                "label": matrix_unit_label(),
                "scopes": ["matrix"],
                "values": sorted(units),
            }
        )
    if annotations:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.annotation",
                "label": matrix_annotation_label(),
                "scopes": ["matrix"],
                "values": sorted(annotations),
            }
        )
    if assemblies:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.assembly.name",
                "label": matrix_assembly_label(),
                "scopes": ["matrix"],
                "values": sorted(assemblies),
            }
        )
    for oid, label in sorted(assay_terms.items()):
        terms.append(
            {
                "type": "OBI",
                "id": oid,
                "label": label,
                "scopes": ["matrix"],
            }
        )
    for oid, label in sorted(feature_types.items()):
        terms.append(
            {
                "type": "SO",
                "id": oid,
                "label": so_display_label(label, fallback_id=oid),
                "scopes": ["matrix"],
            }
        )
    if profile_sources:
        terms.append(
            {
                "type": "custom",
                "id": "matrix.profileSource",
                "label": matrix_profile_source_label(),
                "scopes": ["matrix"],
                # Machine values (encode/geo/gtex); UI pretty-prints for display.
                "values": sorted(profile_sources),
            }
        )

    terms = merge_filtering_terms(terms, load_matrix_seed_terms())

    resources = [
        {
            "id": "so",
            "name": "Sequence Ontology",
            "nameSpacePrefix": "SO",
            "iriPrefix": "http://purl.obolibrary.org/obo/SO_",
            "url": "http://purl.obolibrary.org/obo/so.obo",
        },
        {
            "id": "obi",
            "name": "Ontology for Biomedical Investigations",
            "nameSpacePrefix": "OBI",
            "iriPrefix": "http://purl.obolibrary.org/obo/OBI_",
            "url": "http://purl.obolibrary.org/obo/obi.owl",
        },
    ]
    return terms, resources
