#!/usr/bin/env python3
"""Build package-level tissue feature summary for Explore heatmap + filters.

Writes ``tissue_feature_summary.parquet`` with columns:
  wrapper_id, ontology_id, percentile, n_biosamples, n_matrices, level

Row existence is the absence contract: a gene gets a row for a column only
when it is a member of at least one matrix that has that column. Missing row
= real absence. Level 0 = measured but below / not detected, 1 = high
(percentile >= 90), 2 = specific (high in T and not high in any reference
tissue other than T).

Cross-matrix merge: among matrices where the gene is measured in the column,
pick the matrix with the most biosamples (tie → higher percentile). ``matrix:*``
columns are never reference tissues; reference tissues need
TISSUE_REFERENCE_MIN_BIOSAMPLES package-wide samples.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

SERVER_DIR = SCRIPTS_DIR.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Build package-level tissue_feature_summary.parquet"
    )
    p.add_argument("--package", type=Path, required=True)
    return p


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def build_package(package: Path) -> None:
    from duckdb_util import configure_duckdb_connection, connect_duckdb
    from beacon.tissue_catalog import (
        MATRIX_PSEUDO_PREFIX,
        TISSUE_HIGH_PERCENTILE,
        TISSUE_REFERENCE_MIN_BIOSAMPLES,
    )

    package = package.resolve()
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"missing {manifest_path}")
    feature_matrix = package / "feature_matrix.parquet"
    if not feature_matrix.is_file():
        raise SystemExit(f"missing {feature_matrix}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    matrices: List[Dict[str, Any]] = list(manifest.get("matrices") or [])
    if not matrices:
        raise SystemExit("manifest has no matrices")

    out = package / "tissue_feature_summary.parquet"
    labels_out = package / "tissue_column_labels.parquet"
    temp_dir = package / ".duckdb-tmp-tissue-summary"
    temp_dir.mkdir(parents=True, exist_ok=True)
    con = connect_duckdb(database=":memory:")
    try:
        configure_duckdb_connection(
            con,
            memory_limit=os.environ.get("DUCKDB_MEMORY_LIMIT") or "2GB",
            temp_directory=str(temp_dir),
        )
        con.execute("SET preserve_insertion_order=false")
        con.execute(
            f"""
            CREATE TEMP TABLE feature_matrix AS
            SELECT
              CAST(wrapper_id AS VARCHAR) AS wrapper_id,
              CAST(feature_id AS VARCHAR) AS feature_id,
              CAST(matrix_id AS VARCHAR) AS matrix_id
            FROM read_parquet('{_sql_path(feature_matrix)}')
            """
        )

        parts: List[str] = []
        label_parts: List[str] = []
        for entry in matrices:
            mid = entry.get("matrix_id")
            dirname = entry.get("dir") or mid
            if not mid:
                continue
            matrix_dir = package / "matrices" / str(dirname)
            stats = matrix_dir / "tissue_expression_stats.parquet"
            bios = matrix_dir / "biosamples.parquet"
            if not stats.is_file():
                raise SystemExit(f"missing {stats}; run build_tissue_expression_stats first")
            mid_lit = str(mid).replace("'", "''")
            parts.append(
                f"""
                SELECT
                  fm.wrapper_id,
                  CAST(s.ontology_id AS VARCHAR) AS ontology_id,
                  s.percentile,
                  CAST(s.n_biosamples AS BIGINT) AS n_biosamples,
                  CAST('{mid_lit}' AS VARCHAR) AS matrix_id
                FROM read_parquet('{_sql_path(stats)}') s
                JOIN feature_matrix fm
                  ON fm.feature_id = CAST(s.feature_id AS VARCHAR)
                 AND fm.matrix_id = '{mid_lit}'
                """
            )
            if bios.is_file():
                label_parts.append(
                    f"""
                    SELECT
                      CASE
                        WHEN ontology_id IS NULL
                          OR TRIM(CAST(ontology_id AS VARCHAR)) = ''
                        THEN 'matrix:{mid_lit}'
                        ELSE CAST(ontology_id AS VARCHAR)
                      END AS ontology_id,
                      CAST(any_value(ontology_label) AS VARCHAR) AS label,
                      count(*) AS n_biosamples,
                      CAST('{mid_lit}' AS VARCHAR) AS matrix_id
                    FROM read_parquet('{_sql_path(bios)}')
                    GROUP BY 1
                    """
                )

        if not parts:
            raise SystemExit("no per-matrix tissue stats to summarise")

        con.execute(
            "CREATE TEMP TABLE per_matrix AS " + " UNION ALL ".join(parts)
        )

        # Package-wide column biosample counts (for labels + reference set).
        if label_parts:
            con.execute(
                "CREATE TEMP TABLE column_by_matrix AS "
                + " UNION ALL ".join(label_parts)
            )
        else:
            con.execute(
                """
                CREATE TEMP TABLE column_by_matrix AS
                SELECT
                  ontology_id,
                  CAST(NULL AS VARCHAR) AS label,
                  max(n_biosamples) AS n_biosamples,
                  matrix_id
                FROM per_matrix
                GROUP BY ontology_id, matrix_id
                """
            )

        # Representation invariant: every matrix's columns cover all biosamples.
        for entry in matrices:
            mid = entry.get("matrix_id")
            dirname = entry.get("dir") or mid
            if not mid:
                continue
            bios = package / "matrices" / str(dirname) / "biosamples.parquet"
            if not bios.is_file():
                continue
            expected = int(
                con.execute(
                    f"SELECT count(*) FROM read_parquet('{_sql_path(bios)}')"
                ).fetchone()[0]
            )
            got = int(
                con.execute(
                    """
                    SELECT coalesce(sum(n_biosamples), 0)
                    FROM column_by_matrix
                    WHERE matrix_id = ?
                    """,
                    [str(mid)],
                ).fetchone()[0]
            )
            if expected != got:
                raise RuntimeError(
                    f"{mid}: column biosample sum {got} != biosample count {expected}"
                )

        con.execute(
            """
            CREATE TEMP TABLE column_totals AS
            SELECT
              ontology_id,
              any_value(label) FILTER (WHERE label IS NOT NULL AND label <> '') AS label,
              sum(n_biosamples) AS n_biosamples
            FROM column_by_matrix
            GROUP BY ontology_id
            """
        )

        # Best-powered matrix per (wrapper, column) among measured matrices.
        con.execute(
            f"""
            CREATE TEMP TABLE best AS
            SELECT
              wrapper_id,
              ontology_id,
              percentile,
              n_biosamples,
              n_matrices
            FROM (
              SELECT
                wrapper_id,
                ontology_id,
                percentile,
                n_biosamples,
                count(*) OVER (
                  PARTITION BY wrapper_id, ontology_id
                ) AS n_matrices,
                row_number() OVER (
                  PARTITION BY wrapper_id, ontology_id
                  ORDER BY
                    n_biosamples DESC,
                    percentile DESC NULLS LAST,
                    matrix_id ASC
                ) AS rn
              FROM per_matrix
            ) t
            WHERE rn = 1
            """
        )

        # Reference tissues (package-wide n >= threshold, never matrix:*).
        con.execute(
            f"""
            CREATE TEMP TABLE reference_tissues AS
            SELECT ontology_id
            FROM column_totals
            WHERE n_biosamples >= {int(TISSUE_REFERENCE_MIN_BIOSAMPLES)}
              AND ontology_id NOT LIKE '{MATRIX_PSEUDO_PREFIX.replace("'", "''")}%'
            """
        )

        high = float(TISSUE_HIGH_PERCENTILE)
        con.execute(
            f"""
            CREATE TEMP TABLE high_hits AS
            SELECT wrapper_id, ontology_id
            FROM best
            WHERE percentile IS NOT NULL AND percentile >= {high}
            """
        )

        # Specific: high in T and not high in any other reference tissue.
        con.execute(
            """
            CREATE TEMP TABLE specific_hits AS
            SELECT h.wrapper_id, h.ontology_id
            FROM high_hits h
            WHERE NOT EXISTS (
              SELECT 1
              FROM high_hits o
              JOIN reference_tissues r ON r.ontology_id = o.ontology_id
              WHERE o.wrapper_id = h.wrapper_id
                AND o.ontology_id <> h.ontology_id
            )
            """
        )

        con.execute(
            f"""
            CREATE TEMP TABLE summary AS
            SELECT
              b.wrapper_id,
              b.ontology_id,
              b.percentile,
              b.n_biosamples,
              b.n_matrices,
              CASE
                WHEN b.percentile IS NOT NULL AND b.percentile >= {high}
                  AND s.wrapper_id IS NOT NULL THEN 2
                WHEN b.percentile IS NOT NULL AND b.percentile >= {high} THEN 1
                ELSE 0
              END AS level
            FROM best b
            LEFT JOIN specific_hits s
              ON s.wrapper_id = b.wrapper_id
             AND s.ontology_id = b.ontology_id
            """
        )

        # Absence contract: every summary row must come from membership.
        orphan = con.execute(
            """
            SELECT count(*) FROM summary s
            WHERE NOT EXISTS (
              SELECT 1 FROM per_matrix p
              WHERE p.wrapper_id = s.wrapper_id
                AND p.ontology_id = s.ontology_id
            )
            """
        ).fetchone()[0]
        if int(orphan) != 0:
            raise RuntimeError(
                f"tissue_feature_summary has {orphan} rows without membership"
            )

        con.execute(
            f"COPY summary TO '{_sql_path(out)}' "
            f"(FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        con.execute(
            f"""
            COPY (
              SELECT ontology_id, label, n_biosamples
              FROM column_totals
              ORDER BY ontology_id
            ) TO '{_sql_path(labels_out)}'
            (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        n_rows = int(con.execute("SELECT count(*) FROM summary").fetchone()[0])
        n_cols = int(con.execute("SELECT count(*) FROM column_totals").fetchone()[0])
    finally:
        con.close()
        import shutil

        shutil.rmtree(temp_dir, ignore_errors=True)

    manifest["tissueFeatureSummary"] = {
        "path": "tissue_feature_summary.parquet",
        "labelsPath": "tissue_column_labels.parquet",
        "rowCount": n_rows,
        "columnCount": n_cols,
        "highPercentile": TISSUE_HIGH_PERCENTILE,
        "referenceMinBiosamples": TISSUE_REFERENCE_MIN_BIOSAMPLES,
        "note": (
            "Package-level gene×tissue levels for Explore; missing row = real "
            "absence; level 0/1/2 = below/high/specific"
        ),
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {out} rows={n_rows} columns={n_cols}; "
        f"labels={labels_out}; updated {manifest_path}"
    )


def main(argv: Optional[list] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    print(f"Building tissue feature summary in {args.package}")
    build_package(args.package)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
