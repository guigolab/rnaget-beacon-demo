#!/usr/bin/env python3
"""Make every feature addressable by its own id in ``gene_lookup.parquet``.

Explore asks one Beacon question per gene x tissue cell, for example
``symbol = ENSG00000163631.16 AND feature.resource = GenCode AND
tissue.percentile:UBERON:0002107 >= 99`` (boolean granularity). That only
works when the feature's own id is a lookup key. Features without any symbol
(a few hundred Ensembl genes) have no ``feature_id`` row in ``gene_lookup``,
so the symbol filter could never match them. This step appends one
``lookup_kind = 'feature_id'`` row for each such feature (idempotent) and keeps
``manifest.genes.lookupRows`` in sync.
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


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Add missing feature_id rows to gene_lookup")
    p.add_argument("--package", type=Path, required=True)
    return p


def _sql_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "''")


def build_package(package: Path) -> int:
    """Append missing feature_id lookup rows. Returns how many were added."""
    from duckdb_util import configure_duckdb_connection, connect_duckdb

    package = package.resolve()
    lookup = package / "gene_lookup.parquet"
    feature_index = package / "feature_index.parquet"
    manifest_path = package / "manifest.json"
    for needed in (lookup, feature_index, manifest_path):
        if not needed.is_file():
            raise SystemExit(f"missing {needed}")

    tmp = lookup.with_suffix(".parquet.tmp")
    con = connect_duckdb(database=":memory:")
    try:
        configure_duckdb_connection(
            con, memory_limit=os.environ.get("DUCKDB_MEMORY_LIMIT") or "1GB"
        )
        con.execute(
            f"""
            CREATE TEMP TABLE have AS
            SELECT DISTINCT CAST(feature_id AS VARCHAR) AS feature_id
            FROM read_parquet('{_sql_path(lookup)}')
            WHERE CAST(lookup_key AS VARCHAR) = CAST(feature_id AS VARCHAR)
            """
        )
        con.execute(
            f"""
            CREATE TEMP TABLE missing AS
            SELECT CAST(f.feature_id AS VARCHAR) AS feature_id,
                   CAST(f.resource AS VARCHAR) AS resource
            FROM read_parquet('{_sql_path(feature_index)}') f
            WHERE CAST(f.feature_id AS VARCHAR) NOT IN (SELECT feature_id FROM have)
            """
        )
        added = int(con.execute("SELECT count(*) FROM missing").fetchone()[0])
        if added == 0:
            print("gene_lookup already has a feature_id row for every feature")
            return 0
        con.execute(
            f"""
            COPY (
              SELECT * FROM read_parquet('{_sql_path(lookup)}')
              UNION ALL BY NAME
              SELECT
                feature_id AS lookup_key,
                upper(feature_id) AS lookup_key_norm,
                'feature_id' AS lookup_kind,
                feature_id,
                resource,
                resource AS annotation_source
              FROM missing
            ) TO '{_sql_path(tmp)}' (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        total = int(
            con.execute(
                f"SELECT count(*) FROM read_parquet('{_sql_path(tmp)}')"
            ).fetchone()[0]
        )
    finally:
        con.close()
    tmp.replace(lookup)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    genes = manifest.get("genes")
    if isinstance(genes, dict):
        genes["lookupRows"] = total
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Added {added} feature_id rows to {lookup} (rows={total})")
    return added


def main(argv: Optional[list] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    build_package(args.package)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
