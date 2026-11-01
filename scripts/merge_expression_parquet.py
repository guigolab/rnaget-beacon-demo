#!/usr/bin/env python3
"""Merge per-matrix expression/part-*.parquet into expression.parquet (low RAM)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Merge sharded expression Parquet parts into one file per matrix"
    )
    p.add_argument(
        "--package",
        type=Path,
        required=True,
        help="Path to data-package directory",
    )
    p.add_argument(
        "--keep-shards",
        action="store_true",
        help="Keep expression/part-*.parquet after merge (default: delete)",
    )
    return p


def _parquet_num_rows(path: Path) -> int:
    """Row count from footer metadata only (does not load column data)."""
    import pyarrow.parquet as pq

    meta = pq.ParquetFile(path).metadata
    return int(meta.num_rows) if meta is not None else 0


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def _merge_with_duckdb(parts: List[Path], out_path: Path) -> int:
    from duckdb_util import connect_duckdb

    pattern = (parts[0].parent / "part-*.parquet").resolve()
    src = _sql_path(pattern)
    dest = _sql_path(out_path)
    con = connect_duckdb(database=":memory:")
    try:
        con.execute(
            f"COPY (SELECT * FROM read_parquet('{src}', union_by_name := true)) "
            f"TO '{dest}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
    finally:
        con.close()
    return _parquet_num_rows(out_path)


def _merge_matrix_expression(matrix_dir: Path, *, keep_shards: bool) -> Dict[str, Any]:
    expr_dir = matrix_dir / "expression"
    out_path = matrix_dir / "expression.parquet"
    parts = sorted(expr_dir.glob("part-*.parquet")) if expr_dir.is_dir() else []

    if out_path.is_file() and not parts:
        return {
            "path": "expression.parquet",
            "rows": _parquet_num_rows(out_path),
            "merged": False,
            "parts_removed": 0,
        }

    if not parts:
        raise FileNotFoundError(
            f"{matrix_dir}: no expression/part-*.parquet and no expression.parquet"
        )

    tmp_out = out_path.with_suffix(".parquet.partial")
    if tmp_out.exists():
        tmp_out.unlink()

    try:
        # DuckDB only — a full-shard PyArrow fallback would blow RAM on large parts.
        try:
            rows = _merge_with_duckdb(parts, tmp_out)
        except Exception as exc:
            if tmp_out.exists():
                tmp_out.unlink(missing_ok=True)
            raise RuntimeError(
                f"DuckDB merge failed for {matrix_dir.name}: {exc}. "
                "Install/fix duckdb, or raise DUCKDB_MEMORY_LIMIT / set "
                "DUCKDB_TEMP_DIR; refusing high-RAM PyArrow fallback."
            ) from exc
        tmp_out.replace(out_path)
    except Exception:
        if tmp_out.exists():
            tmp_out.unlink(missing_ok=True)
        raise

    removed = 0
    if not keep_shards:
        for p in parts:
            p.unlink()
            removed += 1
        try:
            if expr_dir.is_dir() and not any(expr_dir.iterdir()):
                expr_dir.rmdir()
        except OSError:
            pass

    return {
        "path": "expression.parquet",
        "rows": rows,
        "merged": True,
        "parts_removed": removed,
        "method": "duckdb",
    }


def merge_package(package: Path, *, keep_shards: bool = False) -> Dict[str, Any]:
    package = package.resolve()
    manifest_path = package / "manifest.json"
    matrices_path = package / "matrices.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Missing {manifest_path}")
    if not matrices_path.is_file():
        raise SystemExit(f"Missing {matrices_path}")

    with manifest_path.open(encoding="utf-8") as fh:
        manifest: Dict[str, Any] = json.load(fh)
    with matrices_path.open(encoding="utf-8") as fh:
        matrices: List[Dict[str, Any]] = json.load(fh)

    by_id = {m.get("matrixId"): m for m in matrices if isinstance(m, dict)}
    results: List[Dict[str, Any]] = []

    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        dirname = entry.get("dir")
        if not mid or not dirname:
            raise SystemExit(f"Incomplete manifest matrix entry: {entry!r}")
        matrix_dir = package / "matrices" / dirname
        info = _merge_matrix_expression(matrix_dir, keep_shards=keep_shards)
        rel = f"matrices/{dirname}/expression.parquet"
        entry["expressionPath"] = rel
        entry["expressionRows"] = info["rows"]
        shards = entry.get("shards") or {}
        shards["merged"] = True
        shards["rows"] = info["rows"]
        shards.pop("parts", None)
        entry["shards"] = shards

        doc = by_id.get(mid)
        if doc is not None:
            pkg = dict(doc.get("package") or {})
            pkg["expressionPath"] = rel
            pkg["expressionRows"] = info["rows"]
            if "shards" in pkg:
                pkg["shards"] = {
                    **(pkg.get("shards") or {}),
                    "merged": True,
                    "rows": info["rows"],
                }
                pkg["shards"].pop("parts", None)
            doc["package"] = pkg
            info_obj = dict(doc.get("info") or {})
            if "package" in info_obj or pkg:
                info_obj["package"] = pkg
            doc["info"] = info_obj

        results.append({"matrix_id": mid, **info})
        method = info.get("method", "cached")
        print(
            f"  {mid}: expression.parquet rows={info['rows']} "
            f"merged={info['merged']} method={method} "
            f"parts_removed={info['parts_removed']}"
        )

    with manifest_path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    with matrices_path.open("w", encoding="utf-8") as fh:
        json.dump(matrices, fh, indent=2)
        fh.write("\n")

    return {"matrices": results}


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    print(f"Merging expression shards in {args.package.resolve()}")
    merge_package(args.package, keep_shards=args.keep_shards)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
