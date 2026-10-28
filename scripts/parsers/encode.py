"""ENCODE RSEM gene-quantifications parser (tall: gene_id × TPM, one biosample)."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .base import (
    NormalizedMatrix,
    _open_text,
    _slug,
    register_parser,
    resolve_source_file,
)


@register_parser("encode")
def parse_encode(
    profile: Dict[str, Any],
    cache_dir: Path,
    max_genes: int,
    max_samples: int,
    *,
    skip_download: bool = False,
) -> NormalizedMatrix:
    del max_samples  # single-sample file; unused
    path = resolve_source_file(
        profile.get("download") or {},
        cache_dir=cache_dir,
        skip_download=skip_download,
    )
    return parse_encode_gene_quantifications(
        path, profile, max_genes=max_genes
    )


def parse_encode_gene_quantifications(
    path: Path,
    profile: Dict[str, Any],
    *,
    max_genes: int = 0,
) -> NormalizedMatrix:
    """Parse ENCODE/RSEM gene quantifications TSV (one biosample).

    Expected columns include gene_id and TPM (names configurable via profile).
    max_genes <= 0 means import all rows matching feature_id_prefix.
    """
    matrix_id = profile["matrix_id"]
    delim = profile.get("delimiter") or "\t"
    gene_col_name = profile.get("gene_id_column") or "gene_id"
    value_col_name = profile.get("value_column") or "TPM"
    prefix = profile.get("feature_id_prefix") or "ENSG"
    annotation = profile.get("annotation") or {"source": "gencode", "version": "unknown"}
    resource = annotation.get("source") or "gencode"
    feature_type = profile.get("feature_type") or {
        "id": "SO:0000704",
        "label": "gene",
    }
    biosample_cfg = dict(profile.get("biosample") or {})
    biosample_id = (
        biosample_cfg.get("id")
        or biosample_cfg.get("biosampleId")
        or "ENCBS-unknown"
    )
    biosample_cfg["id"] = biosample_id
    biosample_cfg["biosampleId"] = biosample_id
    biosample_cfg["matrixIds"] = [matrix_id]

    download = profile.get("download") or {}
    download_url = download.get("url") or ""
    file_acc = biosample_cfg.get("file") or ""

    features: List[Dict[str, Any]] = []
    expression_rows: List[Tuple[str, str, str, float]] = []
    gene_count = 0

    with _open_text(path) as fh:
        reader = csv.DictReader(fh, delimiter=delim)
        if not reader.fieldnames:
            raise ValueError(f"Empty or missing header in {path}")
        fields = {name.strip(): name for name in reader.fieldnames if name}
        if gene_col_name not in fields:
            raise ValueError(
                f"Column {gene_col_name!r} not found in {path}; "
                f"have {list(reader.fieldnames)}"
            )
        if value_col_name not in fields:
            raise ValueError(
                f"Column {value_col_name!r} not found in {path}; "
                f"have {list(reader.fieldnames)}"
            )
        gene_key = fields[gene_col_name]
        value_key = fields[value_col_name]

        for row in reader:
            native_id = (row.get(gene_key) or "").strip()
            if not native_id or not native_id.startswith(prefix):
                continue

            raw = (row.get(value_key) or "").strip()
            if raw == "" or raw.upper() == "NA":
                continue
            try:
                value = float(raw)
            except ValueError:
                continue
            if value != value:  # NaN
                continue

            # Count only accepted features toward the slice budget.
            gene_count += 1
            if max_genes > 0 and gene_count > max_genes:
                break

            unversioned = native_id.split(".", 1)[0]
            wrapper_id = f"feature-{_slug(native_id)}"
            features.append(
                {
                    "id": wrapper_id,
                    "nativeId": native_id,
                    "resource": resource,
                    "featureType": feature_type,
                    "aliases": [unversioned] if unversioned != native_id else [],
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
            expression_rows.append((matrix_id, native_id, biosample_id, value))

    unit = profile.get("unit") or "TPM"
    scale = profile.get("scale") or "linear"
    assembly = profile.get("assembly") or {
        "accession": "GCA_000001405.15",
        "name": "GRCh38",
    }
    assay_type = profile.get("assay_type") or {
        "id": "OBI:0003090",
        "label": "polyA plus RNA-seq",
    }

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
            "features": len(features),
            "biosamples": 1,
        },
        "info": {
            "profile": profile.get("profile"),
            "sourceFile": str(path.name),
            "encodeFile": file_acc,
            "lab": biosample_cfg.get("lab"),
            "sliced": bool(max_genes and max_genes > 0),
            "maxGenes": max_genes,
            "format": "encode_rsem_gene_quantifications",
        },
    }

    return NormalizedMatrix(
        matrix=matrix,
        features=features,
        biosamples=[biosample_cfg],
        expression_rows=expression_rows,
    )
