"""Matrix catalog filtering and filtering_terms for the demo Beacon."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Set

from beacon.filters import (
    MATRIX_ALPHANUMERIC_FIELDS,
    matrix_annotation_filter_value,
    matrix_matches,
)
from beacon.matrix_catalog_seed import load_matrix_seed_terms, merge_filtering_terms


def list_matrices_filtered(
    matrices: Sequence[Dict[str, Any]], filters: Optional[Sequence[Any]]
) -> List[Dict[str, Any]]:
    if not filters:
        return list(matrices)
    return [m for m in matrices if matrix_matches(m, filters)]


def build_matrix_filtering_terms(
    matrices: Sequence[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Facet catalog for matrix-scoped terms on root /filtering_terms."""
    units: Set[str] = set()
    scales: Set[str] = set()
    annotations: Set[str] = set()
    assemblies: Set[str] = set()
    reproducible: Set[str] = set()
    profile_sources: Set[str] = set()
    assay_terms: Dict[str, str] = {}
    feature_types: Dict[str, str] = {}

    for m in matrices:
        uas = m.get("expressionUnitAndScale") or {}
        if uas.get("unit"):
            units.add(str(uas["unit"]))
        if uas.get("scale"):
            scales.add(str(uas["scale"]))
        ann = m.get("annotation") or {}
        merged = matrix_annotation_filter_value(ann.get("source"), ann.get("version"))
        if merged:
            annotations.add(merged)
        asm = m.get("assembly") or {}
        if asm.get("name"):
            assemblies.add(str(asm["name"]))
        reproducible.add("true" if m.get("reproducible") else "false")
        info = m.get("info") or {}
        ps = info.get("profileSource") or info.get("catalogSource")
        if ps:
            profile_sources.add(str(ps))
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
    if units:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.unit",
                "label": "Expression unit",
                "scopes": ["matrix"],
                "values": sorted(units),
            }
        )
    if scales:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.scale",
                "label": "Expression scale",
                "scopes": ["matrix"],
                "values": sorted(scales),
            }
        )
    if annotations:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.annotation",
                "label": "Annotation",
                "scopes": ["matrix"],
                "values": sorted(annotations),
            }
        )
    if assemblies:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.assembly.name",
                "label": "Assembly",
                "scopes": ["matrix"],
                "values": sorted(assemblies),
            }
        )
    terms.append(
        {
            "type": "alphanumeric",
            "id": "matrix.reproducible",
            "label": "Reproducible quantification",
            "scopes": ["matrix"],
            "values": sorted(reproducible),
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
                "label": label,
                "scopes": ["matrix"],
            }
        )
    if profile_sources:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.profileSource",
                "label": "Catalog source",
                "scopes": ["matrix"],
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
