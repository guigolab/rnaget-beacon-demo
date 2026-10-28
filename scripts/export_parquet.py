#!/usr/bin/env python3
"""Export encode/geo/gtex profiles to a gene-sharded Parquet data package."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Allow `python scripts/export_parquet.py` from repo root or scripts/
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

SCHEMA_VERSION = "1"
CELLS_PER_SHARD = 5_000_000
EXPR_BATCH_ROWS = 50_000
KNOWN_PROFILES = ("encode", "geo", "gtex")
MATRIX_SCHEMA_PATH = SCRIPTS_DIR / "schemas" / "matrix.beacon-v2.json"


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Export RNA-seq profiles to a Parquet data package (no Postgres)"
    )
    p.add_argument(
        "--profiles",
        default="encode,geo,gtex",
        help="Comma-separated profile names (default: encode,geo,gtex)",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("dist/data-package"),
        help="Output package directory",
    )
    p.add_argument("--max-genes", type=int, default=None, help="Slice override (0=unlimited)")
    p.add_argument(
        "--max-samples", type=int, default=None, help="Slice override (0=unlimited)"
    )
    p.add_argument(
        "--skip-download",
        action="store_true",
        help="Use scripts/.cache only",
    )
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Download cache directory",
    )
    p.add_argument("--verbose", action="store_true")
    return p


def feature_shard_index(feature_id: str, n_shards: int) -> int:
    digest = hashlib.md5(feature_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % n_shards


def compute_n_shards(n_features: int, n_biosamples: int) -> int:
    expected = max(1, n_features * max(1, n_biosamples))
    return max(1, int(math.ceil(expected / CELLS_PER_SHARD)))


def _write_table(path: Path, rows: List[Dict[str, Any]], *, empty_schema=None) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        schema = empty_schema or pa.schema([])
        pq.write_table(pa.Table.from_batches([], schema=schema), path, compression="zstd")
        return
    table = pa.Table.from_pylist(rows)
    pq.write_table(table, path, compression="zstd")


def _stream_expression_shards(
    expression_dir: Path,
    rows: Iterable[Tuple[str, str, str, float]],
    *,
    n_shards: int,
    matrix_id: str,
) -> Dict[str, Any]:
    """Route expression rows into gene-keyed parquet parts; return shard stats."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    expression_dir.mkdir(parents=True, exist_ok=True)
    schema = pa.schema(
        [
            ("matrix_id", pa.string()),
            ("feature_id", pa.string()),
            ("biosample_id", pa.string()),
            ("value", pa.float64()),
        ]
    )
    writers: List[Optional[pq.ParquetWriter]] = [None] * n_shards
    buffers: List[List[Dict[str, Any]]] = [[] for _ in range(n_shards)]
    counts = [0] * n_shards
    total = 0

    def flush(i: int) -> None:
        buf = buffers[i]
        if not buf:
            return
        table = pa.Table.from_pylist(buf, schema=schema)
        path = expression_dir / f"part-{i:05d}.parquet"
        if writers[i] is None:
            writers[i] = pq.ParquetWriter(path, schema, compression="zstd")
        writers[i].write_table(table)
        counts[i] += len(buf)
        buf.clear()

    try:
        for mid, feature_id, biosample_id, value in rows:
            idx = feature_shard_index(feature_id, n_shards)
            buffers[idx].append(
                {
                    "matrix_id": mid,
                    "feature_id": feature_id,
                    "biosample_id": biosample_id,
                    "value": float(value),
                }
            )
            total += 1
            if len(buffers[idx]) >= EXPR_BATCH_ROWS:
                flush(idx)
            if total % (EXPR_BATCH_ROWS * 10) == 0 and total:
                print(f"  … {matrix_id} expression rows written: {total}", flush=True)
        for i in range(n_shards):
            flush(i)
    finally:
        for w in writers:
            if w is not None:
                w.close()

    # Ensure empty shards exist for stable part numbering when N>1 but unused
    for i in range(n_shards):
        path = expression_dir / f"part-{i:05d}.parquet"
        if not path.exists():
            pq.write_table(pa.Table.from_batches([], schema=schema), path, compression="zstd")

    return {
        "n_shards": n_shards,
        "rows": total,
        "parts": [
            {"file": f"part-{i:05d}.parquet", "rows": counts[i]} for i in range(n_shards)
        ],
        "shard_by": "md5(feature_id) % n_shards",
    }


def export_profile(
    profile_name: str,
    *,
    out_root: Path,
    max_genes: Optional[int],
    max_samples: Optional[int],
    skip_download: bool,
    cache_dir: Path,
    gene_symbols: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    from parsers import get_parser, load_profile
    from parsers.base import resolve_slice
    import parsers.encode  # noqa: F401
    import parsers.geo  # noqa: F401
    import parsers.gtex  # noqa: F401
    from export_enrichment import enrich_biosamples, enrich_features

    profile = load_profile(profile_name)
    if not profile.get("matrix_id"):
        raise SystemExit(f"Profile {profile_name} missing matrix_id")
    mg, ms = resolve_slice(profile, max_genes, max_samples)
    parser = get_parser(profile_name)
    print(
        f"Exporting profile={profile_name} matrix_id={profile['matrix_id']} "
        f"max_genes={mg} max_samples={ms}"
    )
    normalized = parser(
        profile,
        cache_dir,
        mg,
        ms,
        skip_download=skip_download,
    )
    matrix_id = normalized.matrix["matrixId"]
    matrix_dir = out_root / "matrices" / _safe_matrix_dirname(matrix_id)
    matrix_dir.mkdir(parents=True, exist_ok=True)

    feat_rows = enrich_features(
        normalized.features,
        matrix_id=matrix_id,
        profile_name=profile_name,
        gene_symbols=gene_symbols,
    )
    sample_rows = enrich_biosamples(
        normalized.biosamples,
        matrix_id=matrix_id,
        profile=profile,
        profile_name=profile_name,
    )
    _write_table(matrix_dir / "features.parquet", feat_rows)
    _write_table(matrix_dir / "biosamples.parquet", sample_rows)

    n_shards = compute_n_shards(len(feat_rows), len(sample_rows))
    print(
        f"  features={len(feat_rows)} biosamples={len(sample_rows)} "
        f"n_shards={n_shards}"
    )
    shard_info = _stream_expression_shards(
        matrix_dir / "expression",
        normalized.expression_rows,
        n_shards=n_shards,
        matrix_id=matrix_id,
    )
    print(f"  expression rows={shard_info['rows']}")

    matrix_doc = dict(normalized.matrix)
    matrix_doc["package"] = {
        "featuresPath": f"matrices/{_safe_matrix_dirname(matrix_id)}/features.parquet",
        "biosamplesPath": f"matrices/{_safe_matrix_dirname(matrix_id)}/biosamples.parquet",
        "expressionDir": f"matrices/{_safe_matrix_dirname(matrix_id)}/expression",
        "shards": shard_info,
    }
    matrix_doc = normalize_matrix_document(matrix_doc, profile)
    return {
        "matrix": matrix_doc,
        "matrix_id": matrix_id,
        "profile": profile_name,
        "shards": shard_info,
        "dir": _safe_matrix_dirname(matrix_id),
    }


def _safe_matrix_dirname(matrix_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in matrix_id)


def _utc_now_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_matrix_document(
    matrix: Dict[str, Any],
    profile: Dict[str, Any],
    *,
    create_date_time: Optional[str] = None,
) -> Dict[str, Any]:
    """Align exported matrix metadata with beacon-v2 matrix schema."""
    doc = dict(matrix)
    matrix_id = doc.get("matrixId") or profile.get("matrix_id")
    if not matrix_id:
        raise ValueError("matrix document missing matrixId")
    doc["matrixId"] = matrix_id
    doc["id"] = matrix_id
    doc["createDateTime"] = create_date_time or _utc_now_z()

    # Annotation: prefer profile pins (GTF/GFF file URL) over parser defaults.
    annotation = dict(doc.get("annotation") or {})
    profile_ann = profile.get("annotation") or {}
    for key in ("source", "version", "file", "md5Checksum"):
        if profile_ann.get(key) is not None:
            annotation[key] = profile_ann[key]
    if not annotation.get("source") or not annotation.get("version"):
        raise ValueError(f"matrix {matrix_id}: annotation.source/version required")
    if not annotation.get("file"):
        raise ValueError(
            f"matrix {matrix_id}: annotation.file (quantification GTF/GFF URL) required"
        )
    doc["annotation"] = annotation

    eus = dict(doc.get("expressionUnitAndScale") or {})
    eus.setdefault("unit", profile.get("unit") or "raw")
    eus.setdefault("scale", profile.get("scale") or "linear")
    doc["expressionUnitAndScale"] = eus

    ft = doc.get("featureType")
    if isinstance(ft, dict):
        doc["featureType"] = [ft]
    elif not isinstance(ft, list) or not ft:
        raise ValueError(f"matrix {matrix_id}: featureType must be a non-empty array")

    info = dict(doc.get("info") or {})
    quant_md5 = (profile.get("download") or {}).get("md5")
    if quant_md5:
        info["quantFileMd5"] = quant_md5
    # Keep package paths discoverable under info as well as top-level.
    if "package" in doc and "package" not in info:
        info["package"] = doc["package"]
    doc["info"] = info

    if "reproducible" not in doc:
        doc["reproducible"] = bool(profile.get("reproducible", False))
    return doc


def load_matrix_schema() -> Dict[str, Any]:
    if not MATRIX_SCHEMA_PATH.is_file():
        raise FileNotFoundError(f"Missing matrix schema: {MATRIX_SCHEMA_PATH}")
    with MATRIX_SCHEMA_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def validate_matrices(matrices: List[Dict[str, Any]]) -> None:
    import jsonschema
    from jsonschema import FormatChecker

    schema = load_matrix_schema()
    validator = jsonschema.Draft202012Validator(schema, format_checker=FormatChecker())
    errors: List[str] = []
    for i, matrix in enumerate(matrices):
        mid = matrix.get("matrixId") or f"index-{i}"
        for err in sorted(validator.iter_errors(matrix), key=lambda e: list(e.path)):
            path = ".".join(str(p) for p in err.path) or "<root>"
            errors.append(f"{mid}: {path}: {err.message}")
        ann = matrix.get("annotation") or {}
        if not ann.get("file"):
            errors.append(f"{mid}: annotation.file missing (GTF/GFF URL required)")
    if errors:
        joined = "\n  ".join(errors[:20])
        more = f"\n  … and {len(errors) - 20} more" if len(errors) > 20 else ""
        raise SystemExit(f"matrices.json failed beacon-v2 validation:\n  {joined}{more}")


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        return _run(args)
    except SystemExit:
        raise
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        if args.verbose:
            traceback.print_exc()
        return 1


def _run(args: argparse.Namespace) -> int:
    from parsers.base import CACHE_DIR
    from export_enrichment import load_geo_gene_symbols

    names = [p.strip() for p in args.profiles.split(",") if p.strip()]
    for name in names:
        if name not in KNOWN_PROFILES:
            raise SystemExit(f"Unknown profile {name!r}. Known: {KNOWN_PROFILES}")

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    cache_dir = args.cache_dir or CACHE_DIR

    gene_symbols = None
    if "geo" in names:
        print("Loading GEO GeneID→Symbol annotation…")
        gene_symbols = load_geo_gene_symbols(
            cache_dir, skip_download=args.skip_download
        )
        print(f"  annotation symbols={len(gene_symbols)}")

    matrices: List[Dict[str, Any]] = []
    manifest_matrices: List[Dict[str, Any]] = []

    for name in names:
        info = export_profile(
            name,
            out_root=out,
            max_genes=args.max_genes,
            max_samples=args.max_samples,
            skip_download=args.skip_download,
            cache_dir=cache_dir,
            gene_symbols=gene_symbols if name == "geo" else None,
        )
        matrices.append(info["matrix"])
        manifest_matrices.append(
            {
                "matrix_id": info["matrix_id"],
                "profile": info["profile"],
                "dir": info["dir"],
                "shards": info["shards"],
            }
        )

    validate_matrices(matrices)

    matrices_path = out / "matrices.json"
    with matrices_path.open("w", encoding="utf-8") as fh:
        json.dump(matrices, fh, indent=2)
        fh.write("\n")

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "createdAt": _utc_now_z(),
        "profiles": names,
        "shardCellsTarget": CELLS_PER_SHARD,
        "matrices": manifest_matrices,
    }
    with (out / "manifest.json").open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(f"Wrote package to {out.resolve()}")
    print(f"  matrices.json ({len(matrices)} matrices; beacon-v2 validated)")
    print("  manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
