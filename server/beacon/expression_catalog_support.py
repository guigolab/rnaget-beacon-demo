"""Scan per-matrix expression stats for catalog-supported filter ids.

Used by root and per-matrix filtering_terms builders so advertised terms
match what stats (and therefore DuckDB match) can actually satisfy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

from beacon.expression_filter_maps import (
    EXPRESSION_PERCENTILE_ID,
    PERCENTILE_CATALOG_VALUES,
    PERCENTILE_THRESHOLDS,
)

# Descending so strongest thresholds are preferred when intersecting values.
ORDERED_PERCENTILE_THRESHOLDS = (99, 95, 90)


@dataclass
class MatrixExpressionCatalogSupport:
    """Observed expression facets for one matrix."""

    # Threshold ints (90/95/99) that at least one feature can satisfy.
    percentile_thresholds: Set[int] = field(default_factory=set)
    # (sex_lower, ontology_id) -> (sex_display, tissue_label, count)
    sex_tissue_presets: Dict[Tuple[str, str], Tuple[str, Optional[str], int]] = field(
        default_factory=dict
    )

    @property
    def has_percentile_thresholds(self) -> bool:
        return bool(self.percentile_thresholds)

    @property
    def is_eligible(self) -> bool:
        """True when this matrix contributes expression.percentile."""
        return self.has_percentile_thresholds

    def ordered_percentile_thresholds(self) -> List[int]:
        """Observed percentile thresholds in descending strength order."""
        out: List[int] = []
        for thr in ORDERED_PERCENTILE_THRESHOLDS:
            if thr in self.percentile_thresholds and thr in PERCENTILE_THRESHOLDS:
                out.append(thr)
        return out

    def percentile_catalog_values(self) -> List[str]:
        """Observed chip values in catalog order (90, 95, 99)."""
        observed = {str(t) for t in self.ordered_percentile_thresholds()}
        return [v for v in PERCENTILE_CATALOG_VALUES if v in observed]

    def categorical_expression_ids(self) -> Set[str]:
        """Filter ids this matrix's stats can satisfy (allow-list for subset)."""
        ids: Set[str] = set()
        if self.has_percentile_thresholds:
            ids.add(EXPRESSION_PERCENTILE_ID)
        return ids


def _merge_preset(
    dest: Dict[Tuple[str, str], Tuple[str, Optional[str], int]],
    key: Tuple[str, str],
    sex_disp: str,
    tissue: Optional[str],
    count: int = 1,
) -> None:
    if key in dest:
        prev_sex, prev_tissue, prev_n = dest[key]
        dest[key] = (prev_sex, prev_tissue or tissue, prev_n + count)
    else:
        dest[key] = (sex_disp, tissue, count)


def _record_percentile(support: MatrixExpressionCatalogSupport, value: object) -> None:
    if value is None:
        return
    try:
        pct = float(value)
    except (TypeError, ValueError):
        return
    if not (pct == pct):  # NaN
        return
    for thr in ORDERED_PERCENTILE_THRESHOLDS:
        if pct >= thr:
            support.percentile_thresholds.add(thr)


def scan_matrix_expression_support(matrix_dir: Path) -> MatrixExpressionCatalogSupport:
    """Read stats (+ biosample presets) for one matrix directory."""
    import pyarrow.parquet as pq

    support = MatrixExpressionCatalogSupport()
    feat_stats = matrix_dir / "feature_expression_stats.parquet"
    bio_path = matrix_dir / "biosamples.parquet"

    if feat_stats.is_file():
        names = set(pq.read_schema(feat_stats).names)
        if "median_percentile" in names:
            for batch in pq.ParquetFile(feat_stats).iter_batches(
                columns=["median_percentile"], batch_size=8192
            ):
                for row in batch.to_pylist():
                    _record_percentile(support, row.get("median_percentile"))

    if bio_path.is_file():
        bio_names = set(pq.read_schema(bio_path).names)
        want_bio = [
            c for c in ("ontology_id", "ontology_label", "sex") if c in bio_names
        ]
        if want_bio:
            for batch in pq.ParquetFile(bio_path).iter_batches(
                columns=want_bio, batch_size=8192
            ):
                for row in batch.to_pylist():
                    oid = row.get("ontology_id")
                    oid_s = str(oid).strip() if oid is not None else ""
                    olabel = row.get("ontology_label")
                    olabel_s = str(olabel) if olabel else None
                    sex = row.get("sex")
                    if sex and oid_s:
                        sex_s = str(sex).strip()
                        if sex_s:
                            _merge_preset(
                                support.sex_tissue_presets,
                                (sex_s.lower(), oid_s),
                                sex_s,
                                olabel_s,
                            )

    return support


def merge_expression_support(
    parts: Iterable[MatrixExpressionCatalogSupport],
) -> MatrixExpressionCatalogSupport:
    """Union supports across matrices (for root catalog emission)."""
    merged = MatrixExpressionCatalogSupport()
    for part in parts:
        merged.percentile_thresholds |= part.percentile_thresholds
        for key, (sex_disp, tissue, count) in part.sex_tissue_presets.items():
            _merge_preset(merged.sex_tissue_presets, key, sex_disp, tissue, count)
    return merged


def top_sex_tissue_presets(
    presets: Dict[Tuple[str, str], Tuple[str, Optional[str], int]],
    *,
    cap: int = 200,
) -> List[Tuple[Tuple[str, str], Tuple[str, Optional[str], int]]]:
    """Sort UBERON presets first, then by descending frequency; take top ``cap``."""
    items = list(presets.items())

    def _key(
        kv: Tuple[Tuple[str, str], Tuple[str, Optional[str], int]],
    ) -> Tuple[int, int, str, str]:
        (_sex_l, oid), (_sex_disp, _tissue, count) = kv
        uber = 0 if oid.upper().startswith("UBERON:") else 1
        return (uber, -count, _sex_l, oid)

    items.sort(key=_key)
    return items[:cap]
