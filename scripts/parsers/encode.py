"""ENCODE RSEM gene-quantifications parser (tall: gene_id × TPM per biosample)."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import (
    NormalizedMatrix,
    _open_text,
    _slug,
    profile_source,
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
    raw_multi = profile.get("biosamples")
    n_configured = (
        len(raw_multi)
        if isinstance(raw_multi, list) and raw_multi
        else 1
    )
    biosample_cfgs = _resolve_encode_biosamples(profile, max_samples=max_samples)
    return parse_encode_gene_quantifications(
        biosample_cfgs,
        profile,
        cache_dir=cache_dir,
        max_genes=max_genes,
        max_samples=max_samples,
        n_configured_biosamples=n_configured,
        skip_download=skip_download,
    )


def _resolve_encode_biosamples(
    profile: Dict[str, Any],
    *,
    max_samples: int,
) -> List[Dict[str, Any]]:
    """Return biosample configs with per-sample download blocks.

    Supports:
    - ``biosamples:`` list (each item has its own ``download``)
    - legacy singular ``biosample`` + top-level ``download``
    """
    multi = profile.get("biosamples")
    if isinstance(multi, list) and multi:
        cfgs = [dict(item) for item in multi if isinstance(item, dict)]
        if max_samples > 0:
            cfgs = cfgs[:max_samples]
        if not cfgs:
            raise ValueError("Profile biosamples list is empty after slicing")
        return cfgs

    biosample_cfg = dict(profile.get("biosample") or {})
    download = dict(profile.get("download") or {})
    if download:
        biosample_cfg["download"] = download
    return [biosample_cfg]


def _iter_encode_tpm_rows(
    path: Path,
    *,
    delim: str,
    gene_col_name: str,
    value_col_name: str,
    prefix: str,
    max_genes: int,
) -> List[Tuple[str, float]]:
    """Return (native_gene_id, tpm) rows from one RSEM gene-quantifications TSV."""
    rows: List[Tuple[str, float]] = []
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

            gene_count += 1
            if max_genes > 0 and gene_count > max_genes:
                break
            rows.append((native_id, value))
    return rows


def parse_encode_gene_quantifications(
    biosample_cfgs: List[Dict[str, Any]],
    profile: Dict[str, Any],
    *,
    cache_dir: Path,
    max_genes: int = 0,
    max_samples: int = 0,
    n_configured_biosamples: int = 1,
    skip_download: bool = False,
) -> NormalizedMatrix:
    """Parse one or more ENCODE/RSEM gene quantification TSVs into one matrix.

    Expected columns include gene_id and TPM (names configurable via profile).
    max_genes <= 0 means import all rows matching feature_id_prefix (applied per file
    consistently via the first file's gene set when merging).
    """
    if not biosample_cfgs:
        raise ValueError("At least one encode biosample is required")

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

    features_by_id: Dict[str, Dict[str, Any]] = {}
    feature_order: List[str] = []
    expression_rows: List[Tuple[str, str, str, float]] = []
    biosamples: List[Dict[str, Any]] = []
    source_files: List[str] = []
    encode_files: List[str] = []
    first_download_url = ""
    allowed_genes: Optional[set[str]] = None

    for idx, raw_cfg in enumerate(biosample_cfgs):
        biosample_cfg = dict(raw_cfg)
        download = dict(biosample_cfg.pop("download", None) or {})
        if not download and idx == 0 and profile.get("download"):
            download = dict(profile.get("download") or {})
        if not download.get("url") and not download.get("path"):
            raise ValueError(
                f"Encode biosample {biosample_cfg.get('id')!r} missing download.url/path"
            )

        path = resolve_source_file(
            download,
            cache_dir=cache_dir,
            skip_download=skip_download,
        )
        source_files.append(path.name)
        if not first_download_url:
            first_download_url = download.get("url") or ""

        biosample_id = (
            biosample_cfg.get("id")
            or biosample_cfg.get("biosampleId")
            or f"ENCBS-unknown-{idx + 1}"
        )
        biosample_cfg["id"] = biosample_id
        biosample_cfg["biosampleId"] = biosample_id
        biosample_cfg["matrixIds"] = [matrix_id]
        file_acc = biosample_cfg.get("file") or ""
        if file_acc:
            encode_files.append(str(file_acc))
        biosamples.append(biosample_cfg)

        # First file defines the gene slice; later files only emit values for those genes.
        per_file_max = max_genes if allowed_genes is None else 0
        tpm_rows = _iter_encode_tpm_rows(
            path,
            delim=delim,
            gene_col_name=gene_col_name,
            value_col_name=value_col_name,
            prefix=prefix,
            max_genes=per_file_max,
        )
        if allowed_genes is None:
            allowed_genes = {gid for gid, _ in tpm_rows}
            for native_id, _ in tpm_rows:
                if native_id in features_by_id:
                    continue
                unversioned = native_id.split(".", 1)[0]
                features_by_id[native_id] = {
                    "id": f"feature-{_slug(native_id)}",
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
                feature_order.append(native_id)

        for native_id, value in tpm_rows:
            if allowed_genes is not None and native_id not in allowed_genes:
                continue
            expression_rows.append((matrix_id, native_id, biosample_id, value))

    features = [features_by_id[gid] for gid in feature_order]

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

    lab = next((b.get("lab") for b in biosamples if b.get("lab")), None)
    matrix = {
        "matrixId": matrix_id,
        "name": profile.get("name") or matrix_id,
        "description": profile.get("description") or "",
        "downloadUrl": first_download_url
        or f"https://www.encodeproject.org/experiments/{matrix_id}/",
        "expressionUnitAndScale": {"unit": unit, "scale": scale},
        "featureType": [feature_type],
        "annotation": annotation,
        "assembly": assembly,
        "assayType": assay_type,
        "reproducible": bool(profile.get("reproducible", False)),
        "dimensions": {
            "features": len(features),
            "biosamples": len(biosamples),
        },
        "info": {
            "source": profile_source(profile),
            "sourceFile": source_files[0] if len(source_files) == 1 else source_files,
            "encodeFile": encode_files[0] if len(encode_files) == 1 else encode_files,
            "lab": lab,
            "sliced": bool(
                (max_genes and max_genes > 0)
                or (max_samples and max_samples > 0 and len(biosamples) < n_configured_biosamples)
            ),
            "maxGenes": max_genes,
            "maxSamples": max_samples,
            "format": "encode_rsem_gene_quantifications",
            "expectedExpressionCells": len(features) * len(biosamples),
        },
    }

    return NormalizedMatrix(
        matrix=matrix,
        features=features,
        biosamples=biosamples,
        expression_rows=expression_rows,
    )
