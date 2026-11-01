#!/usr/bin/env python3
"""Build per-matrix expression min/max stats parquet + matrices.json expressionValueRange."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Compute feature/biosample expression stats and matrix expressionValueRange"
        )
    )
    p.add_argument(
        "--package",
        type=Path,
        required=True,
        help="Path to data-package directory",
    )
    return p


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def _expression_source(matrix_dir: Path) -> Optional[str]:
    """Return a DuckDB read_parquet path/glob for this matrix's expression data."""
    merged = matrix_dir / "expression.parquet"
    if merged.is_file():
        return f"read_parquet('{_sql_path(merged)}')"
    expr_dir = matrix_dir / "expression"
    parts = sorted(expr_dir.glob("part-*.parquet")) if expr_dir.is_dir() else []
    if parts:
        pattern = (expr_dir / "part-*.parquet").resolve()
        return f"read_parquet('{_sql_path(pattern)}', union_by_name=true)"
    return None


def build_matrix_stats(matrix_dir: Path) -> Tuple[float, float, int, int]:
    """Write stats parquet files; return (global_min, global_max, n_features, n_biosamples).

    Uses two GROUP BY scans of expression (feature- and biosample-scoped). Global
    min/max and row counts come from the aggregated temp tables — no third full
    expression scan and no re-read of the written parquet files.
    """
    from duckdb_util import connect_duckdb

    source = _expression_source(matrix_dir)
    if not source:
        raise FileNotFoundError(
            f"{matrix_dir}: need expression.parquet or expression/part-*.parquet"
        )

    feat_out = matrix_dir / "feature_expression_stats.parquet"
    bio_out = matrix_dir / "biosample_expression_stats.parquet"
    con = connect_duckdb(database=":memory:")
    try:
        con.execute(
            f"""
            CREATE TEMP TABLE feat_stats AS
            SELECT
              feature_id,
              min(value) AS min_value,
              max(value) AS max_value,
              arg_min(biosample_id, value) AS min_biosample_id,
              arg_max(biosample_id, value) AS max_biosample_id
            FROM {source}
            GROUP BY feature_id
            """
        )
        con.execute(
            f"""
            CREATE TEMP TABLE bio_stats AS
            SELECT
              biosample_id,
              min(value) AS min_value,
              max(value) AS max_value,
              arg_min(feature_id, value) AS min_feature_id,
              arg_max(feature_id, value) AS max_feature_id
            FROM {source}
            GROUP BY biosample_id
            """
        )
        con.execute(
            f"COPY feat_stats TO '{_sql_path(feat_out)}' "
            f"(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        con.execute(
            f"COPY bio_stats TO '{_sql_path(bio_out)}' "
            f"(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        # Global extrema ≡ min of per-feature mins / max of per-feature maxes.
        row = con.execute(
            "SELECT min(min_value), max(max_value), count(*) FROM feat_stats"
        ).fetchone()
        n_bio = con.execute("SELECT count(*) FROM bio_stats").fetchone()[0]
    finally:
        con.close()

    gmin = float(row[0]) if row and row[0] is not None else 0.0
    gmax = float(row[1]) if row and row[1] is not None else 0.0
    n_feat = int(row[2]) if row else 0
    return gmin, gmax, n_feat, int(n_bio)


def build_package(package: Path) -> None:
    package = package.resolve()
    matrices_path = package / "matrices.json"
    manifest_path = package / "manifest.json"
    if not matrices_path.is_file():
        raise SystemExit(f"missing {matrices_path}")
    if not manifest_path.is_file():
        raise SystemExit(f"missing {manifest_path}")

    matrices: List[Dict[str, Any]] = json.loads(
        matrices_path.read_text(encoding="utf-8")
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_id = {m.get("matrixId"): m for m in matrices if isinstance(m, dict)}

    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        dirname = entry.get("dir") or mid
        if not mid:
            continue
        matrix_dir = package / "matrices" / dirname
        print(f"  {mid}: computing expression stats…")
        gmin, gmax, n_feat, n_bio = build_matrix_stats(matrix_dir)
        doc = by_id.get(mid)
        if doc is not None:
            doc["expressionValueRange"] = {"min": gmin, "max": gmax}
        print(
            f"  {mid}: features={n_feat} biosamples={n_bio} "
            f"range=[{gmin}, {gmax}]"
        )

    matrices_path.write_text(
        json.dumps(matrices, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Updated {matrices_path}")


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    print(f"Building expression stats in {args.package}")
    build_package(args.package)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
