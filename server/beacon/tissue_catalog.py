"""Tissue / cell column helpers for tissueHigh / tissueSpecific custom filters.

Columns cover every ontology id observed on biosamples, plus
``matrix:{matrixId}`` for samples with a null ontology. There is no
minimum sample count for ranking. Specificity uses only reference
tissues (n >= TISSUE_REFERENCE_MIN_BIOSAMPLES); ``matrix:*`` columns
are never reference tissues.
"""

from __future__ import annotations

from typing import Optional

# "High" means within-tissue median percentile at or above this threshold.
TISSUE_HIGH_PERCENTILE = 90.0
# Explore heatmap discrete presence band (stricter than tissueHigh filters).
TISSUE_EXPLORE_BAND_PERCENTILE = 99.0
# Only tissues with at least this many biosamples (package-wide) can
# veto specificity for another tissue.
TISSUE_REFERENCE_MIN_BIOSAMPLES = 8

TISSUE_HIGH_PREFIX = "tissueHigh:"
TISSUE_SPECIFIC_PREFIX = "tissueSpecific:"
# Within-tissue percentile >= 99 (catalogued on genomicFeature; Explore bands).
TISSUE_TOP_PREFIX = "tissueTop:"
# Any row in tissue summary for oid (catalogued on genomicFeature; Explore bands).
TISSUE_PRESENT_PREFIX = "tissuePresent:"
MATRIX_PSEUDO_PREFIX = "matrix:"


def matrix_pseudo_ontology_id(matrix_id: str) -> str:
    return f"{MATRIX_PSEUDO_PREFIX}{matrix_id}"


def is_matrix_pseudo_ontology_id(ontology_id: str) -> bool:
    return str(ontology_id or "").startswith(MATRIX_PSEUDO_PREFIX)


def tissue_column_display_name(
    ontology_id: str, label: Optional[str] = None
) -> str:
    if label and str(label).strip():
        return str(label).strip()
    if is_matrix_pseudo_ontology_id(ontology_id):
        mid = ontology_id[len(MATRIX_PSEUDO_PREFIX) :]
        return f"Unannotated ({mid})" if mid else "Unannotated"
    return ontology_id
