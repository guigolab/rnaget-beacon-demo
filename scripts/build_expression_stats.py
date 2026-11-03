#!/usr/bin/env python3
"""Build per-matrix expression stats parquet + matrices.json expressionValueRange.

Feature stats include min/max/mean/median, detection counts, expression
percentile band (quintiles of median among detected features), and (when the
matrix has enough biosamples and ≥2 ontology groups) profile / enriched_in
labels. Biosample stats include detected_genes and a percentile band.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Minimum biosample count before band / profile labels are assigned.
MIN_N = 10
# Enrichment: max group median must be ≥ this multiple of the mean of others.
ENRICHMENT_RATIO = 4.0
# Detected in at least this fraction → "ubiquitous".
UBIQUITOUS_FRACTION = 0.9
# Detected below this fraction → "not-detected".
NOT_DETECTED_FRACTION = 0.05
# Quintile labels for ntile(5) among detected features / biosamples.
# Tile 1 = lowest 20% … tile 5 = highest 20%. Undetected → "none".
PERCENTILE_BAND_TILES = {
    1: "0-20",
    2: "20-40",
    3: "40-60",
    4: "60-80",
    5: "80-100",
}
PERCENTILE_BAND_NTILE = 5


def _percentile_band_sql(tile_col: str) -> str:
    """CASE arms mapping ntile buckets to explicit percentile-range labels."""
    arms = "\n".join(
        f"                WHEN {tile_col} = {tile} THEN '{label}'"
        for tile, label in sorted(PERCENTILE_BAND_TILES.items())
    )
    return arms


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


def _biosample_group_sql(matrix_dir: Path) -> Optional[str]:
    """Return a subquery of (biosample_id, group_id) when ontology_id is present."""
    bio_path = matrix_dir / "biosamples.parquet"
    if not bio_path.is_file():
        return None
    import pyarrow.parquet as pq

    names = set(pq.read_schema(bio_path).names)
    if "biosample_id" not in names or "ontology_id" not in names:
        return None
    return (
        f"SELECT biosample_id, "
        f"COALESCE(NULLIF(TRIM(CAST(ontology_id AS VARCHAR)), ''), 'undefined') "
        f"AS group_id "
        f"FROM read_parquet('{_sql_path(bio_path)}')"
    )


def build_matrix_stats(matrix_dir: Path) -> Tuple[float, float, int, int]:
    """Write stats parquet files; return (global_min, global_max, n_features, n_biosamples)."""
    from duckdb_util import connect_duckdb

    source = _expression_source(matrix_dir)
    if not source:
        raise FileNotFoundError(
            f"{matrix_dir}: need expression.parquet or expression/part-*.parquet"
        )

    feat_out = matrix_dir / "feature_expression_stats.parquet"
    bio_out = matrix_dir / "biosample_expression_stats.parquet"
    group_sql = _biosample_group_sql(matrix_dir)
    temp_dir = matrix_dir / ".duckdb-tmp-stats"
    temp_dir.mkdir(parents=True, exist_ok=True)
    con = connect_duckdb(database=":memory:")
    try:
        from duckdb_util import configure_duckdb_connection

        configure_duckdb_connection(con, temp_directory=str(temp_dir))
        con.execute("SET preserve_insertion_order=false")
        # Per-feature aggregates (zeros are stored, so n == stored row count).
        con.execute(
            f"""
            CREATE TEMP TABLE feat_base AS
            SELECT
              feature_id,
              count(*) AS n,
              count(*) FILTER (WHERE value > 0) AS nonzero_count,
              CASE
                WHEN count(*) = 0 THEN 0.0
                ELSE CAST(count(*) FILTER (WHERE value > 0) AS DOUBLE) / count(*)
              END AS detected_fraction,
              min(value) AS min_value,
              max(value) AS max_value,
              avg(value) AS mean,
              median(value) AS median,
              arg_min(biosample_id, value) AS min_biosample_id,
              arg_max(biosample_id, value) AS max_biosample_id
            FROM {source}
            GROUP BY feature_id
            """
        )

        n_bio = int(
            con.execute(
                f"SELECT count(DISTINCT biosample_id) FROM {source}"
            ).fetchone()[0]
        )

        # Profile / enrichment when the matrix is large enough and multi-group.
        can_profile = False
        if group_sql is not None and n_bio >= MIN_N:
            con.execute(f"CREATE TEMP TABLE bio_groups AS {group_sql}")
            n_groups = int(
                con.execute(
                    "SELECT count(DISTINCT group_id) FROM bio_groups "
                    "WHERE group_id != 'undefined'"
                ).fetchone()[0]
            )
            can_profile = n_groups >= 2

        if can_profile:
            con.execute(
                f"""
                CREATE TEMP TABLE feat_group_med AS
                SELECT
                  e.feature_id,
                  g.group_id,
                  median(e.value) AS group_median,
                  count(*) FILTER (WHERE e.value > 0) AS group_nonzero
                FROM {source} e
                JOIN bio_groups g USING (biosample_id)
                WHERE g.group_id != 'undefined'
                GROUP BY e.feature_id, g.group_id
                """
            )
            con.execute(
                """
                CREATE TEMP TABLE feat_enrich AS
                SELECT
                  feature_id,
                  arg_max(group_id, group_median) AS top_group,
                  max(group_median) AS top_median,
                  CASE
                    WHEN count(*) <= 1 THEN NULL
                    WHEN (sum(group_median) - max(group_median))
                         / NULLIF(count(*) - 1, 0) <= 0
                      THEN NULL
                    WHEN max(group_median) >= ? * (
                         (sum(group_median) - max(group_median))
                         / NULLIF(count(*) - 1, 0)
                       )
                      THEN arg_max(group_id, group_median)
                    ELSE NULL
                  END AS enriched_in
                FROM feat_group_med
                GROUP BY feature_id
                """,
                [ENRICHMENT_RATIO],
            )
            enrich_join = "LEFT JOIN feat_enrich e USING (feature_id)"
            enrich_select = "e.enriched_in AS enriched_in"
            profile_extra = (
                "WHEN e.enriched_in IS NOT NULL THEN 'tissue-enriched'"
            )
        else:
            enrich_join = ""
            enrich_select = "CAST(NULL AS VARCHAR) AS enriched_in"
            profile_extra = "WHEN FALSE THEN NULL"

        # Quintile percentile bands among detected features only.
        con.execute(
            f"""
            CREATE TEMP TABLE feat_detected_tiles AS
            SELECT
              feature_id,
              ntile({PERCENTILE_BAND_NTILE}) OVER (ORDER BY median NULLS LAST)
                AS median_tile
            FROM feat_base
            WHERE detected_fraction > 0
            """
        )
        con.execute(
            f"""
            CREATE TEMP TABLE feat_stats AS
            SELECT
              b.*,
              CASE
                WHEN {n_bio} < {MIN_N} THEN NULL
                WHEN b.detected_fraction <= 0 THEN 'none'
{_percentile_band_sql("t.median_tile")}
                ELSE 'none'
              END AS band,
              CASE
                WHEN {n_bio} < {MIN_N} THEN NULL
                WHEN b.detected_fraction < {NOT_DETECTED_FRACTION}
                  THEN 'not-detected'
                WHEN b.detected_fraction >= {UBIQUITOUS_FRACTION}
                  THEN 'ubiquitous'
                {profile_extra}
                ELSE 'low-specificity'
              END AS profile,
              {enrich_select}
            FROM feat_base b
            LEFT JOIN feat_detected_tiles t USING (feature_id)
            {enrich_join}
            """
        )

        # Per-biosample aggregates.
        con.execute(
            f"""
            CREATE TEMP TABLE bio_base AS
            SELECT
              biosample_id,
              min(value) AS min_value,
              max(value) AS max_value,
              arg_min(feature_id, value) AS min_feature_id,
              arg_max(feature_id, value) AS max_feature_id,
              count(*) FILTER (WHERE value > 0) AS detected_genes
            FROM {source}
            GROUP BY biosample_id
            """
        )
        con.execute(
            f"""
            CREATE TEMP TABLE bio_detected_tiles AS
            SELECT
              biosample_id,
              ntile({PERCENTILE_BAND_NTILE}) OVER (ORDER BY detected_genes)
                AS genes_tile
            FROM bio_base
            WHERE detected_genes > 0
            """
        )
        con.execute(
            f"""
            CREATE TEMP TABLE bio_stats AS
            SELECT
              b.*,
              CASE
                WHEN {n_bio} < {MIN_N} THEN NULL
                WHEN b.detected_genes <= 0 THEN 'none'
{_percentile_band_sql("t.genes_tile")}
                ELSE 'none'
              END AS detected_genes_band
            FROM bio_base b
            LEFT JOIN bio_detected_tiles t USING (biosample_id)
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
        row = con.execute(
            "SELECT min(min_value), max(max_value), count(*) FROM feat_stats"
        ).fetchone()
        n_bio_out = con.execute("SELECT count(*) FROM bio_stats").fetchone()[0]
    finally:
        con.close()
        import shutil

        shutil.rmtree(temp_dir, ignore_errors=True)

    gmin = float(row[0]) if row and row[0] is not None else 0.0
    gmax = float(row[1]) if row and row[1] is not None else 0.0
    n_feat = int(row[2]) if row else 0
    return gmin, gmax, n_feat, int(n_bio_out)


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
