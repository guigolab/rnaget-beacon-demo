#!/usr/bin/env python3
"""Build ``tissue_percentile_wide.parquet``: one row per gene, one column per tissue.

Derived from ``tissue_feature_summary.parquet`` (long: wrapper_id, ontology_id,
percentile). The wide layout answers ``tissue.percentile:<oid> >= X`` with a
single-column scan and no join/sort over the 1.5M-row long table:

  * rows are genes present in ``feature_index`` (the same inner join the API
    applies), so counts and pages match the long-table query exactly;
  * a column is the DOUBLE percentile for that tissue (exact, so a threshold
    like ``>= 99`` never flips on float rounding); NULL = absent or not
    detected (the fast path only serves ``>``/``>=`` which exclude NULL).

The manifest gains ``tissuePercentileWide`` with the path and tissue columns.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

WIDE_FILENAME = "tissue_percentile_wide.parquet"


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Build tissue_percentile_wide.parquet")
    p.add_argument("--package", type=Path, required=True)
    return p


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def build_package(package: Path) -> None:
    from duckdb_util import configure_duckdb_connection, connect_duckdb

    package = package.resolve()
    manifest_path = package / "manifest.json"
    summary = package / "tissue_feature_summary.parquet"
    feature_index = package / "feature_index.parquet"
    for needed in (manifest_path, summary, feature_index):
        if not needed.is_file():
            raise SystemExit(f"missing {needed}")

    out = package / WIDE_FILENAME
    con = connect_duckdb(database=":memory:")
    try:
        configure_duckdb_connection(
            con, memory_limit=os.environ.get("DUCKDB_MEMORY_LIMIT") or "2GB"
        )
        con.execute(
            f"""
            COPY (
              PIVOT (
                SELECT
                  CAST(s.wrapper_id AS VARCHAR) AS wrapper_id,
                  CAST(s.ontology_id AS VARCHAR) AS ontology_id,
                  s.percentile
                FROM read_parquet('{_sql_path(summary)}') s
                WHERE CAST(s.wrapper_id AS VARCHAR) IN (
                  SELECT CAST(wrapper_id AS VARCHAR)
                  FROM read_parquet('{_sql_path(feature_index)}')
                )
              )
              ON ontology_id
              USING max(percentile)
              GROUP BY wrapper_id
              ORDER BY wrapper_id
            ) TO '{_sql_path(out)}' (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        described = con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{_sql_path(out)}')"
        ).fetchall()
        ontologies = [str(row[0]) for row in described if row[0] != "wrapper_id"]
        n_rows = int(
            con.execute(
                f"SELECT count(*) FROM read_parquet('{_sql_path(out)}')"
            ).fetchone()[0]
        )
    finally:
        con.close()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["tissuePercentileWide"] = {
        "path": WIDE_FILENAME,
        "rowCount": n_rows,
        "ontologies": ontologies,
        "note": (
            "Gene x tissue percentile matrix for tissue.percentile fast paths; "
            "NULL = absent or not detected"
        ),
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"Wrote {out} rows={n_rows} tissues={len(ontologies)}; updated {manifest_path}"
    )


def main(argv: Optional[list] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    print(f"Building tissue percentile wide table in {args.package}")
    build_package(args.package)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
