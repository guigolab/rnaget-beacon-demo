#!/usr/bin/env python3
"""Build per-matrix within-tissue expression percentiles.

Writes ``matrices/{dir}/tissue_expression_stats.parquet`` with columns:
feature_id, ontology_id, percentile, n_biosamples.

Every biosample lands in exactly one column: its ``ontology_id``, or
``matrix:{matrixId}`` when that is null. Any column with >= 1 biosample
in the matrix is ranked. Genes that are matrix members but have median
0 / NULL keep a row with ``percentile = NULL`` so "below / not detected"
is never confused with real absence (no membership in any matrix that
has the column).
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

SERVER_DIR = SCRIPTS_DIR.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Compute within-tissue feature percentiles for tissueHigh/Specific "
            "(all ontology columns, including matrix: pseudo-tissues)"
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
    merged = matrix_dir / "expression.parquet"
    if merged.is_file():
        return f"read_parquet('{_sql_path(merged)}')"
    expr_dir = matrix_dir / "expression"
    parts = sorted(expr_dir.glob("part-*.parquet")) if expr_dir.is_dir() else []
    if parts:
        pattern = (expr_dir / "part-*.parquet").resolve()
        return f"read_parquet('{_sql_path(pattern)}', union_by_name=true)"
    return None


def build_matrix_tissue_stats(matrix_dir: Path, matrix_id: str) -> int:
    """Write tissue_expression_stats.parquet; return row count."""
    from duckdb_util import configure_duckdb_connection, connect_duckdb
    from beacon.tissue_catalog import matrix_pseudo_ontology_id

    source = _expression_source(matrix_dir)
    bio_path = matrix_dir / "biosamples.parquet"
    feat_path = matrix_dir / "features.parquet"
    if not source:
        raise FileNotFoundError(
            f"{matrix_dir}: need expression.parquet or expression/part-*.parquet"
        )
    if not bio_path.is_file():
        raise FileNotFoundError(f"{matrix_dir}: missing biosamples.parquet")
    if not feat_path.is_file():
        raise FileNotFoundError(f"{matrix_dir}: missing features.parquet")

    out = matrix_dir / "tissue_expression_stats.parquet"
    temp_dir = matrix_dir / ".duckdb-tmp-tissue-stats"
    temp_dir.mkdir(parents=True, exist_ok=True)
    pseudo = matrix_pseudo_ontology_id(matrix_id)
    con = connect_duckdb(database=":memory:")
    try:
        # GTEx-scale matrices need more than the util default (512MB).
        configure_duckdb_connection(
            con,
            memory_limit=os.environ.get("DUCKDB_MEMORY_LIMIT") or "2GB",
            temp_directory=str(temp_dir),
        )
        con.execute("SET preserve_insertion_order=false")

        # Every biosample → exactly one column id.
        con.execute(
            f"""
            CREATE TEMP TABLE column_biosamples AS
            SELECT
              CAST(biosample_id AS VARCHAR) AS biosample_id,
              CASE
                WHEN ontology_id IS NULL
                  OR TRIM(CAST(ontology_id AS VARCHAR)) = ''
                THEN CAST(? AS VARCHAR)
                ELSE CAST(ontology_id AS VARCHAR)
              END AS ontology_id
            FROM read_parquet('{_sql_path(bio_path)}')
            """,
            [pseudo],
        )
        con.execute(
            """
            CREATE TEMP TABLE column_counts AS
            SELECT ontology_id, count(*) AS n_biosamples
            FROM column_biosamples
            GROUP BY ontology_id
            """
        )
        # Invariant: column counts must cover every biosample.
        n_bio = int(
            con.execute("SELECT count(*) FROM column_biosamples").fetchone()[0]
        )
        n_col = int(
            con.execute("SELECT coalesce(sum(n_biosamples), 0) FROM column_counts")
            .fetchone()[0]
        )
        if n_bio != n_col:
            raise RuntimeError(
                f"{matrix_id}: column biosample sum {n_col} != biosample count {n_bio}"
            )

        # Matrix membership defines "measured", not expression-row presence.
        con.execute(
            f"""
            CREATE TEMP TABLE matrix_features AS
            SELECT DISTINCT CAST(feature_id AS VARCHAR) AS feature_id
            FROM read_parquet('{_sql_path(feat_path)}')
            WHERE feature_id IS NOT NULL
            """
        )

        # Feature × column grid for this matrix (membership × present columns).
        con.execute(
            """
            CREATE TEMP TABLE membership_grid AS
            SELECT f.feature_id, c.ontology_id, c.n_biosamples
            FROM matrix_features f
            CROSS JOIN column_counts c
            """
        )

        # Median expression per feature × column (biosamples in that column only).
        con.execute(
            f"""
            CREATE TEMP TABLE observed_medians AS
            SELECT
              CAST(e.feature_id AS VARCHAR) AS feature_id,
              b.ontology_id,
              median(e.value) AS median_value
            FROM {source} e
            JOIN column_biosamples b
              ON CAST(e.biosample_id AS VARCHAR) = b.biosample_id
            GROUP BY CAST(e.feature_id AS VARCHAR), b.ontology_id
            """
        )
        con.execute(
            """
            CREATE TEMP TABLE feat_tissue_median AS
            SELECT
              g.feature_id,
              g.ontology_id,
              g.n_biosamples,
              o.median_value
            FROM membership_grid g
            LEFT JOIN observed_medians o
              USING (feature_id, ontology_id)
            """
        )

        # Percentile among detected (median > 0) genes only; undetected stay NULL.
        con.execute(
            """
            CREATE TEMP TABLE detected_pct AS
            SELECT
              feature_id,
              ontology_id,
              percent_rank() OVER (
                PARTITION BY ontology_id
                ORDER BY median_value
              ) * 100.0 AS percentile
            FROM feat_tissue_median
            WHERE median_value IS NOT NULL AND median_value > 0
            """
        )
        con.execute(
            """
            CREATE TEMP TABLE tissue_stats AS
            SELECT
              m.feature_id,
              m.ontology_id,
              p.percentile,
              m.n_biosamples
            FROM feat_tissue_median m
            LEFT JOIN detected_pct p USING (feature_id, ontology_id)
            """
        )
        con.execute(
            f"COPY tissue_stats TO '{_sql_path(out)}' "
            f"(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        n = int(con.execute("SELECT count(*) FROM tissue_stats").fetchone()[0])
        return n
    finally:
        con.close()
        import shutil

        shutil.rmtree(temp_dir, ignore_errors=True)


def build_package(package: Path) -> None:
    package = package.resolve()
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"missing {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    total_rows = 0
    matrix_count = 0
    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        dirname = entry.get("dir") or mid
        if not mid:
            continue
        matrix_dir = package / "matrices" / dirname
        print(f"  {mid}: computing tissue expression stats…")
        n = build_matrix_tissue_stats(matrix_dir, str(mid))
        print(f"  {mid}: tissue_stats_rows={n}")
        total_rows += n
        matrix_count += 1
    manifest["tissueExpressionStats"] = {
        "matrixCount": matrix_count,
        "rowCount": total_rows,
        "note": (
            "Within-tissue median percentiles for all ontology columns "
            "(including matrix: pseudo-tissues); NULL percentile = measured "
            "but not detected"
        ),
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Updated {manifest_path} (tissueExpressionStats)")


def main(argv: Optional[list] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    print(f"Building tissue expression stats in {args.package}")
    build_package(args.package)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
