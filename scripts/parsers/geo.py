"""GEO NCBI RNA-seq counts wide-matrix parser (GeneID × GSM)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from .base import NormalizedMatrix, parse_wide_matrix, register_parser, resolve_source_file


@register_parser("geo")
def parse_geo(
    profile: Dict[str, Any],
    cache_dir: Path,
    max_genes: int,
    max_samples: int,
    *,
    skip_download: bool = False,
) -> NormalizedMatrix:
    path = resolve_source_file(
        profile.get("download") or {},
        cache_dir=cache_dir,
        skip_download=skip_download,
    )
    normalized = parse_wide_matrix(
        path, profile, max_genes=max_genes, max_samples=max_samples
    )

    # Enrich matrix info for NCBI GEO RNA-seq counts pipeline
    info = dict(normalized.matrix.get("info") or {})
    info["format"] = "geo_ncbi_rnaseq_counts"
    info["geoAccession"] = profile.get("matrix_id") or normalized.matrix.get("matrixId")
    info["pipeline"] = (
        "NCBI GEO RNA-seq counts (HISAT2 + featureCounts, GRCh38.p13)"
    )
    if profile.get("series_design"):
        info["seriesDesign"] = str(profile["series_design"]).strip()
    info["sliced"] = bool(
        (max_genes and max_genes > 0) or (max_samples and max_samples > 0)
    )
    info["expectedExpressionCells"] = (
        len(normalized.features) * len(normalized.biosamples)
    )
    normalized.matrix["info"] = info
    return normalized
