"""Human-friendly display labels for Beacon filtering terms."""

from __future__ import annotations

from typing import Dict, Optional

_BIOTYPE_FAMILY_LABELS: Dict[str, str] = {
    "protein_coding": "Protein-coding",
    "lncRNA": "Long non-coding RNA",
    "pseudogene": "Pseudogene",
    "sncRNA": "Small non-coding RNA",
    "other": "Other feature classes",
}

_PROFILE_SOURCE_LABELS: Dict[str, str] = {
    "encode": "Encode",
    "geo": "GEO",
    "gtex": "GTEx",
}

BIOSAMPLE_STATUS_IDS = frozenset({"EFO:0009654", "EFO:0009655"})
BIOSAMPLE_CATALOG_PREFIXES = frozenset({"UBERON", "EFO"})


def so_display_label(raw: Optional[str], *, fallback_id: Optional[str] = None) -> str:
    """Title-case Sequence Ontology labels (underscores → spaces)."""
    text = (raw or "").strip()
    if not text and fallback_id:
        text = fallback_id.split(":", 1)[-1] if ":" in fallback_id else fallback_id
    if not text:
        return fallback_id or ""
    if text.upper().startswith("SO:"):
        text = text.split(":", 1)[-1]
    spaced = text.replace("_", " ").strip()
    # Preserve short all-caps tokens like RNA, IG, TR when alone.
    parts = []
    for word in spaced.split():
        if word.isupper() and len(word) <= 4:
            parts.append(word)
        else:
            parts.append(word[:1].upper() + word[1:] if word else word)
    return " ".join(parts)


def expression_percentile_label(*, matrix_scoped: bool = False) -> str:
    """Catalog label for custom ``expression.percentile``."""
    base = "Top expressed"
    if matrix_scoped:
        return f"{base} (this matrix)"
    return base


def biotype_family_catalog_label() -> str:
    """Catalog label for custom ``feature.biotypeFamily``."""
    return "Gene type"


def biotype_family_label(family: str) -> str:
    return _BIOTYPE_FAMILY_LABELS.get(family, family)


def matrix_unit_label() -> str:
    return "Units"


def matrix_annotation_label() -> str:
    return "Gene models"


def matrix_assembly_label() -> str:
    return "Genome"


def matrix_profile_source_label() -> str:
    return "Data source"


def profile_source_display_value(raw: str) -> str:
    key = (raw or "").strip().lower()
    return _PROFILE_SOURCE_LABELS.get(key, raw)


def sex_tissue_preset_label(sex: str, tissue: Optional[str], ontology_id: str) -> str:
    """Legacy label helper (presets are no longer catalogued)."""
    sex_disp = (sex or "").strip().capitalize() or sex
    tissue_disp = (tissue or "").strip() or ontology_id
    return f"{sex_disp} · {tissue_disp}"


def tissue_high_label(
    ontology_id: str,
    tissue: Optional[str] = None,
    *,
    n_biosamples: Optional[int] = None,
) -> str:
    """Legacy label helper (tissueHigh is no longer catalogued)."""
    from beacon.tissue_catalog import tissue_column_display_name

    name = tissue_column_display_name(ontology_id, tissue)
    if n_biosamples is not None:
        return f"High in {name} (n={int(n_biosamples)})"
    return f"High in {name}"


def tissue_specific_label(
    ontology_id: str,
    tissue: Optional[str] = None,
    *,
    n_biosamples: Optional[int] = None,
) -> str:
    """Legacy label helper (tissueSpecific is no longer catalogued)."""
    from beacon.tissue_catalog import tissue_column_display_name

    name = tissue_column_display_name(ontology_id, tissue)
    if n_biosamples is not None:
        return f"Specific to {name} (n={int(n_biosamples)})"
    return f"Specific to {name}"


def tissue_top_label(
    ontology_id: str,
    tissue: Optional[str] = None,
    *,
    n_biosamples: Optional[int] = None,
) -> str:
    """Catalog label for custom ``tissueTop:{ontologyId}``."""
    from beacon.tissue_catalog import tissue_column_display_name

    name = tissue_column_display_name(ontology_id, tissue)
    if n_biosamples is not None:
        return f"Top 1% in {name} (n={int(n_biosamples)})"
    return f"Top 1% in {name}"


def tissue_present_label(
    ontology_id: str,
    tissue: Optional[str] = None,
    *,
    n_biosamples: Optional[int] = None,
) -> str:
    """Catalog label for custom ``tissuePresent:{ontologyId}``."""
    from beacon.tissue_catalog import tissue_column_display_name

    name = tissue_column_display_name(ontology_id, tissue)
    if n_biosamples is not None:
        return f"Present in {name} (n={int(n_biosamples)})"
    return f"Present in {name}"


def is_biosample_catalog_ontology_id(oid: str) -> bool:
    """Whether a CURIE may appear as a biosample-scoped filtering term."""
    text = (oid or "").strip()
    if not text:
        return False
    if text in BIOSAMPLE_STATUS_IDS:
        return False
    pref = text.split(":", 1)[0].upper()
    return pref in BIOSAMPLE_CATALOG_PREFIXES
