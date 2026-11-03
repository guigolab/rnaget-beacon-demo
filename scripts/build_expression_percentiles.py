#!/usr/bin/env python3
"""Build per-matrix expression percentile parquet files (fetch-time only).

Writes:
  percentile_in_feature.parquet   (feature_id, biosample_id, pct)
  percentile_in_biosample.parquet (feature_id, biosample_id, pct)

``pct`` is percent_rank() * 100 in [0, 100]. Built after merge because the
release tarball has a 2 GiB per-asset limit; CI packages omit these files.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Compute per-matrix expression percentile parquet files"
    )
    p.add_argument("--package", type=Path, required=True)
    return p


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def _expression_source(matrix_dir: Path) -> Optional[str]:
    merged = matrix_dir / "expression.parquet"
    if merged.is_file():
        return f"read_parquet('{_sql_path(merged)}')"
    expr_dir = matrix_dir / "expression"
    parts = sorted(expr_dir.glob("part-*.parquet")) if expr_dir.is_dir() else []
    if parts:
        pattern = (expr_dir / "part-*.parquet").resolve()
        return f"read_parquet('{_sql_path(pattern)}', union_by_name=true)"
    return None


def build_matrix_percentiles(matrix_dir: Path) -> tuple[int, int]:
    """Write percentile files; return (n_feature_rows, n_biosample_rows)."""
    from duckdb_util import connect_duckdb

    source = _expression_source(matrix_dir)
    if not source:
        raise FileNotFoundError(
            f"{matrix_dir}: need expression.parquet or expression/part-*.parquet"
        )

    feat_out = matrix_dir / "percentile_in_feature.parquet"
    bio_out = matrix_dir / "percentile_in_biosample.parquet"
    # Spill to the matrix dir so large GTEx-scale windows fit under the memory cap.
    temp_dir = matrix_dir / ".duckdb-tmp-percentiles"
    temp_dir.mkdir(parents=True, exist_ok=True)
    con = connect_duckdb(database=":memory:")
    try:
        from duckdb_util import configure_duckdb_connection

        configure_duckdb_connection(con, temp_directory=str(temp_dir))
        con.execute(
            f"""
            COPY (
              SELECT
                feature_id,
                biosample_id,
                percent_rank() OVER (
                  PARTITION BY feature_id ORDER BY value
                ) * 100.0 AS pct
              FROM {source}
            ) TO '{_sql_path(feat_out)}' (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        con.execute(
            f"""
            COPY (
              SELECT
                feature_id,
                biosample_id,
                percent_rank() OVER (
                  PARTITION BY biosample_id ORDER BY value
                ) * 100.0 AS pct
              FROM {source}
            ) TO '{_sql_path(bio_out)}' (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        n_feat = int(
            con.execute(
                f"SELECT count(*) FROM read_parquet('{_sql_path(feat_out)}')"
            ).fetchone()[0]
        )
        n_bio = int(
            con.execute(
                f"SELECT count(*) FROM read_parquet('{_sql_path(bio_out)}')"
            ).fetchone()[0]
        )
    finally:
        con.close()
        # Best-effort cleanup of spill files.
        import shutil

        shutil.rmtree(temp_dir, ignore_errors=True)
    return n_feat, n_bio


def build_package(package: Path) -> None:
    package = package.resolve()
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"missing {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    built: List[str] = []
    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        dirname = entry.get("dir") or mid
        if not mid:
            continue
        matrix_dir = package / "matrices" / dirname
        print(f"  {mid}: computing expression percentiles…")
        n_feat, n_bio = build_matrix_percentiles(matrix_dir)
        built.append(mid)
        print(f"  {mid}: percentile rows feature={n_feat} biosample={n_bio}")

    manifest["expressionPercentiles"] = {
        "matrixCount": len(built),
        "note": "Built at fetch time; optional in CI release packages",
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    print(f"Building expression percentiles in {args.package}")
    build_package(args.package)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
