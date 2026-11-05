"""Catalog tissueTop / tissuePresent custom filtering terms for Beacon discovery.

These ids are already matchable on ``/features``. This module advertises them
in ``/filtering_terms`` (genomicFeature scope) so clients stay Beacon-compliant.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from beacon.filter_display import (
    is_biosample_catalog_ontology_id,
    tissue_present_label,
    tissue_top_label,
)
from beacon.tissue_catalog import (
    TISSUE_PRESENT_PREFIX,
    TISSUE_TOP_PREFIX,
    is_matrix_pseudo_ontology_id,
)


def _column_n(row: Mapping[str, Any]) -> Optional[int]:
    raw = row.get("n_biosamples")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def build_tissue_explore_filtering_terms(
    columns: Sequence[Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    """Build custom Top/Present terms for catalogued tissue/cell ontology ids.

    ``columns`` entries should include ``ontology_id`` and optionally ``label``
    and ``n_biosamples``. Pseudo ``matrix:*`` columns and non-UBERON/EFO ids
    are skipped.
    """
    terms: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for row in columns:
        oid = str(row.get("ontology_id") or "").strip()
        if not oid or oid in seen:
            continue
        if is_matrix_pseudo_ontology_id(oid):
            continue
        if not is_biosample_catalog_ontology_id(oid):
            continue
        seen.add(oid)
        label = row.get("label")
        tissue = str(label).strip() if label else None
        n = _column_n(row)
        terms.append(
            {
                "type": "custom",
                "id": f"{TISSUE_TOP_PREFIX}{oid}",
                "label": tissue_top_label(oid, tissue, n_biosamples=n),
                "scopes": ["genomicFeature"],
            }
        )
        terms.append(
            {
                "type": "custom",
                "id": f"{TISSUE_PRESENT_PREFIX}{oid}",
                "label": tissue_present_label(oid, tissue, n_biosamples=n),
                "scopes": ["genomicFeature"],
            }
        )
    return sorted(terms, key=lambda t: (t.get("id") or "", t.get("type") or ""))


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def load_tissue_column_rows(package: Path) -> List[Dict[str, Any]]:
    """Load tissue column metadata from package parquet files.

    Prefers ``tissue_column_labels.parquet``; falls back to distinct
    ``ontology_id`` / max ``n_biosamples`` from ``tissue_feature_summary.parquet``.

    Uses DuckDB (available in the API image). Avoids pyarrow — it is a
    build/scripts dependency and is not installed in the server container.
    """
    import duckdb

    package = package.resolve()
    labels_path = package / "tissue_column_labels.parquet"
    summary_path = package / "tissue_feature_summary.parquet"
    if not labels_path.is_file() and not summary_path.is_file():
        return []

    con = duckdb.connect(database=":memory:")
    try:
        if labels_path.is_file():
            result = con.execute(
                f"""
                SELECT
                  CAST(ontology_id AS VARCHAR) AS ontology_id,
                  CAST(label AS VARCHAR) AS label,
                  n_biosamples
                FROM read_parquet('{_sql_path(labels_path)}')
                """
            )
            cols = [d[0] for d in result.description]
            return [dict(zip(cols, row)) for row in result.fetchall()]

        result = con.execute(
            f"""
            SELECT
              CAST(ontology_id AS VARCHAR) AS ontology_id,
              max(n_biosamples) AS n_biosamples
            FROM read_parquet('{_sql_path(summary_path)}')
            GROUP BY 1
            """
        )
        cols = [d[0] for d in result.description]
        return [dict(zip(cols, row)) for row in result.fetchall()]
    finally:
        con.close()


def tissue_explore_filtering_terms_for_package(
    package: Path,
) -> List[Dict[str, Any]]:
    """Convenience: load column rows from ``package`` and build catalog terms."""
    return build_tissue_explore_filtering_terms(load_tissue_column_rows(package))


def iter_tissue_explore_term_ids(terms: Iterable[Mapping[str, Any]]) -> List[str]:
    """Return Top/Present term ids from an existing catalog list (test helper)."""
    out: List[str] = []
    for term in terms:
        tid = str(term.get("id") or "")
        if tid.startswith(TISSUE_TOP_PREFIX) or tid.startswith(TISSUE_PRESENT_PREFIX):
            out.append(tid)
    return out
