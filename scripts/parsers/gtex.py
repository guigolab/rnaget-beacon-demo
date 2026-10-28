"""GTEx GCT gene expression parser (wide: ENSG × samples, streamed values)."""

from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple

from .base import (
    NormalizedMatrix,
    _open_text,
    _slug,
    register_parser,
    resolve_source_file,
)


@register_parser("gtex")
def parse_gtex(
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
    return parse_gtex_gct(
        path, profile, max_genes=max_genes, max_samples=max_samples
    )


def _read_gct_header(
    fh, delim: str
) -> Tuple[List[str], Any]:
    """Skip GCT version + dimension lines; return (header, csv reader over rest)."""
    first = fh.readline()
    while first.startswith("#"):
        first = fh.readline()
    if not first:
        raise ValueError("Empty GCT after version comments")

    # Dimension line: mostly integers (e.g. "56200\\t665\\t0\\t0")
    dims_fields = first.rstrip("\n\r").split(delim)
    if dims_fields and dims_fields[0].lstrip("-").isdigit():
        header_line = fh.readline()
    else:
        header_line = first

    if not header_line:
        raise ValueError("Missing GCT column header")

    header = next(csv.reader(io.StringIO(header_line), delimiter=delim))
    rest_reader = csv.reader(fh, delimiter=delim)
    return header, rest_reader


def _iter_gct_expression(
    path: Path,
    *,
    matrix_id: str,
    delim: str,
    feature_col: int,
    sample_start: int,
    sample_names: List[str],
    prefix: str,
    max_genes: int,
) -> Iterator[Tuple[str, str, str, float]]:
    """Re-scan GCT and yield (matrix_id, ensembl_id, sample_id, tpm)."""
    n_samples = len(sample_names)
    gene_count = 0
    with _open_text(path) as fh:
        _header, rest_reader = _read_gct_header(fh, delim)
        del _header
        for row in rest_reader:
            if not row or len(row) <= sample_start:
                continue
            native_id = row[feature_col].strip()
            if not native_id:
                continue
            if prefix and not native_id.startswith(prefix):
                continue
            gene_count += 1
            if max_genes > 0 and gene_count > max_genes:
                break
            values = row[sample_start : sample_start + n_samples]
            for sample_id, raw in zip(sample_names, values):
                raw = (raw or "").strip()
                if raw == "" or raw.upper() == "NA":
                    continue
                try:
                    value = float(raw)
                except ValueError:
                    continue
                yield (matrix_id, native_id, sample_id, value)


def parse_gtex_gct(
    path: Path,
    profile: Dict[str, Any],
    *,
    max_genes: int = 0,
    max_samples: int = 0,
) -> NormalizedMatrix:
    """Parse GTEx-style GCT (#version, dims, id/Name/Description/samples).

    Features and biosamples are collected on the first pass. expression_rows is a
    lazy iterator that re-scans the file so full-tissue matrices do not need to
    sit in RAM.
    """
    matrix_id = profile["matrix_id"]
    delim = profile.get("delimiter") or "\t"
    feature_col = int(profile.get("feature_column", 1))
    sample_start = int(profile.get("sample_start_column", 3))
    desc_col = feature_col + 1
    prefix = profile.get("feature_id_prefix") or "ENSG"
    annotation = profile.get("annotation") or {"source": "gencode", "version": "v26"}
    resource = annotation.get("source") or "gencode"
    feature_type = profile.get("feature_type") or {
        "id": "SO:0000704",
        "label": "gene",
    }
    tissue = profile.get("tissue") or {}

    features: List[Dict[str, Any]] = []
    sample_names: List[str] = []

    with _open_text(path) as fh:
        header, rest_reader = _read_gct_header(fh, delim)
        if len(header) <= sample_start:
            raise ValueError(f"GCT header too short in {path}: {header[:5]!r}…")

        sample_names = header[sample_start:]
        if max_samples > 0:
            sample_names = sample_names[:max_samples]

        gene_count = 0
        for row in rest_reader:
            if not row or len(row) <= sample_start:
                continue
            native_id = row[feature_col].strip()
            if not native_id:
                continue
            if prefix and not native_id.startswith(prefix):
                continue
            gene_count += 1
            if max_genes > 0 and gene_count > max_genes:
                break

            symbol = ""
            if len(row) > desc_col:
                symbol = (row[desc_col] or "").strip()
            unversioned = native_id.split(".", 1)[0]
            aliases = []
            if unversioned != native_id:
                aliases.append(unversioned)
            if symbol and symbol not in aliases:
                aliases.append(symbol)

            wrapper_id = f"feature-{_slug(native_id)}"
            features.append(
                {
                    "id": wrapper_id,
                    "nativeId": native_id,
                    "resource": resource,
                    "featureType": feature_type,
                    "aliases": aliases,
                    "genomicFeature": {
                        "featureIdentifier": {
                            "id": native_id,
                            "resource": resource,
                        },
                        "featureType": feature_type,
                    },
                    "matrixIds": [matrix_id],
                }
            )

    biosamples = []
    for sid in sample_names:
        doc: Dict[str, Any] = {
            "id": sid,
            "biosampleId": sid,
            "matrixIds": [matrix_id],
        }
        if tissue:
            doc["tissue"] = tissue
            doc["sampleType"] = tissue
        biosamples.append(doc)

    unit = profile.get("unit") or "TPM"
    scale = profile.get("scale") or "linear"
    assembly = profile.get("assembly") or {
        "accession": "GCA_000001405.15",
        "name": "GRCh38",
    }
    assay_type = profile.get("assay_type") or {
        "id": "OBI:0003090",
        "label": "bulk RNA-seq assay",
    }
    download_url = (profile.get("download") or {}).get("url") or ""

    n_features = len(features)
    n_biosamples = len(biosamples)
    expected_cells = n_features * n_biosamples

    matrix = {
        "matrixId": matrix_id,
        "name": profile.get("name") or matrix_id,
        "description": profile.get("description") or "",
        "downloadUrl": download_url,
        "expressionUnitAndScale": {"unit": unit, "scale": scale},
        "featureType": [feature_type],
        "annotation": annotation,
        "assembly": assembly,
        "assayType": assay_type,
        "reproducible": bool(profile.get("reproducible", False)),
        "dimensions": {
            "features": n_features,
            "biosamples": n_biosamples,
        },
        "info": {
            "profile": profile.get("profile"),
            "sourceFile": str(path.name),
            "format": "gtex_gct",
            "tissue": tissue,
            "sliced": bool(
                (max_genes and max_genes > 0) or (max_samples and max_samples > 0)
            ),
            "maxGenes": max_genes,
            "maxSamples": max_samples,
            "expectedExpressionCells": expected_cells,
            "expressionStreaming": True,
        },
    }

    expression_rows = _iter_gct_expression(
        path,
        matrix_id=matrix_id,
        delim=delim,
        feature_col=feature_col,
        sample_start=sample_start,
        sample_names=sample_names,
        prefix=prefix,
        max_genes=max_genes,
    )

    return NormalizedMatrix(
        matrix=matrix,
        features=features,
        biosamples=biosamples,
        expression_rows=expression_rows,
    )
