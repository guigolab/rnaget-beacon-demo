"""Matrix catalog filtering and filtering_terms for the demo Beacon."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Set

from beacon.filters import MATRIX_ALPHANUMERIC_FIELDS, matrix_matches


def list_matrices_filtered(
    matrices: Sequence[Dict[str, Any]], filters: Optional[Sequence[Any]]
) -> List[Dict[str, Any]]:
    if not filters:
        return list(matrices)
    return [m for m in matrices if matrix_matches(m, filters)]


def build_matrix_filtering_terms(
    matrices: Sequence[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Facet catalog for /matrices/filtering_terms (Beacon-shaped)."""
    units: Set[str] = set()
    scales: Set[str] = set()
    sources: Set[str] = set()
    versions: Set[str] = set()
    assemblies: Set[str] = set()
    reproducible: Set[str] = set()
    assay_terms: Dict[str, str] = {}
    feature_types: Dict[str, str] = {}

    for m in matrices:
        uas = m.get("expressionUnitAndScale") or {}
        if uas.get("unit"):
            units.add(str(uas["unit"]))
        if uas.get("scale"):
            scales.add(str(uas["scale"]))
        ann = m.get("annotation") or {}
        if ann.get("source"):
            sources.add(str(ann["source"]))
        if ann.get("version"):
            versions.add(str(ann["version"]))
        asm = m.get("assembly") or {}
        if asm.get("name"):
            assemblies.add(str(asm["name"]))
        reproducible.add("true" if m.get("reproducible") else "false")
        assay = m.get("assayType") or {}
        if isinstance(assay, dict) and assay.get("id"):
            assay_terms[str(assay["id"])] = str(assay.get("label") or assay["id"])
        for ft in m.get("featureType") or []:
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
    if sources:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.annotation.source",
                "label": "Annotation source",
                "scopes": ["matrix"],
                "values": sorted(sources),
            }
        )
    if versions:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "matrix.annotation.version",
                "label": "Annotation version",
                "scopes": ["matrix"],
                "values": sorted(versions),
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
