"""Mappings for expression.* and biosample.preset / tissue* filters."""

from __future__ import annotations

from typing import Literal, Optional, Tuple

# Demo chip / catalog values for expression.percentile (0–100; catalog type custom).
PERCENTILE_THRESHOLDS = frozenset({90, 95, 99})
# Ascending catalog order (Beacon values list).
PERCENTILE_CATALOG_VALUES = ("90", "95", "99")
EXPRESSION_PERCENTILE_ID = "expression.percentile"

TissueKind = Literal["high", "specific", "top", "present"]


def parse_biosample_preset(fid: str) -> Optional[Tuple[str, str]]:
    """Return (sex, ontology_id) from ``biosample.preset:{sex}+{ontologyId}``."""
    prefix = "biosample.preset:"
    if not fid.startswith(prefix):
        return None
    rest = fid[len(prefix) :].strip()
    if "+" not in rest:
        return None
    sex, oid = rest.split("+", 1)
    sex = sex.strip()
    oid = oid.strip()
    if not sex or not oid:
        return None
    return sex, oid


def parse_tissue_feature_filter(fid: str) -> Optional[Tuple[TissueKind, str]]:
    """Return (kind, ontology_id) from tissueHigh / Specific / Top / Present ids.

    Accepts any ontology CURIE (``UBERON:…``, ``EFO:…``, …) or a
    ``matrix:{matrixId}`` pseudo-column. No fixed panel membership check.
    ``tissueTop`` / ``tissuePresent`` are Explore-only (not catalogued).
    """
    from beacon.tissue_catalog import (
        MATRIX_PSEUDO_PREFIX,
        TISSUE_HIGH_PREFIX,
        TISSUE_PRESENT_PREFIX,
        TISSUE_SPECIFIC_PREFIX,
        TISSUE_TOP_PREFIX,
    )

    kind: Optional[TissueKind] = None
    rest = ""
    if fid.startswith(TISSUE_HIGH_PREFIX):
        kind = "high"
        rest = fid[len(TISSUE_HIGH_PREFIX) :].strip()
    elif fid.startswith(TISSUE_SPECIFIC_PREFIX):
        kind = "specific"
        rest = fid[len(TISSUE_SPECIFIC_PREFIX) :].strip()
    elif fid.startswith(TISSUE_TOP_PREFIX):
        kind = "top"
        rest = fid[len(TISSUE_TOP_PREFIX) :].strip()
    elif fid.startswith(TISSUE_PRESENT_PREFIX):
        kind = "present"
        rest = fid[len(TISSUE_PRESENT_PREFIX) :].strip()
    else:
        return None
    if not rest or ":" not in rest:
        return None
    # Preserve matrix: casing and matrix id as stored in the package.
    if rest.lower().startswith(MATRIX_PSEUDO_PREFIX.lower()):
        mid = rest.split(":", 1)[1].strip()
        if not mid:
            return None
        return kind, f"{MATRIX_PSEUDO_PREFIX}{mid}"
    pref, local = rest.split(":", 1)
    local = local.strip()
    if not pref.strip() or not local:
        return None
    return kind, f"{pref.upper()}:{local}"


def tissue_high_filter_id(ontology_id: str) -> str:
    from beacon.tissue_catalog import TISSUE_HIGH_PREFIX

    return f"{TISSUE_HIGH_PREFIX}{ontology_id}"


def tissue_specific_filter_id(ontology_id: str) -> str:
    from beacon.tissue_catalog import TISSUE_SPECIFIC_PREFIX

    return f"{TISSUE_SPECIFIC_PREFIX}{ontology_id}"


def tissue_top_filter_id(ontology_id: str) -> str:
    from beacon.tissue_catalog import TISSUE_TOP_PREFIX

    return f"{TISSUE_TOP_PREFIX}{ontology_id}"


def tissue_present_filter_id(ontology_id: str) -> str:
    from beacon.tissue_catalog import TISSUE_PRESENT_PREFIX

    return f"{TISSUE_PRESENT_PREFIX}{ontology_id}"
