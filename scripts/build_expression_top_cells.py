#!/usr/bin/env python3
"""Build ``expression_top_cells.parquet``: the head of each matrix's value ranking.

``expression_values`` without filters ranks every cell of a matrix by value
(42M cells for a GTEx tissue) and the Matrix page asks for exactly that first.
The head of that ranking never changes, so it is precomputed once per matrix and
direction, in the same total order the API uses:

    value {DESC|ASC} NULLS LAST, feature_id ASC, biosample_id ASC

Columns: matrix_id, dir ('desc'|'asc'), feature_id, biosample_id, value.
The server answers unfiltered page requests from these rows when the whole page
lies inside the stored head, and falls back to the full query otherwise.

The manifest gains ``expressionTopCells`` with the path, depth and matrices.
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

TOP_CELLS_FILENAME = "expression_top_cells.parquet"
TOP_CELLS_DEPTH = 5000


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Build expression_top_cells.parquet")
    p.add_argument("--package", type=Path, required=True)
    p.add_argument("--depth", type=int, default=TOP_CELLS_DEPTH)
    return p


def _sql_path(path) -> str:
    return Path(path).resolve().as_posix().replace("'", "''")


def _expression_source(matrix_dir: Path) -> Optional[str]:
    merged = matrix_dir / "expression.parquet"
    if merged.is_file():
        return f"read_parquet('{_sql_path(merged)}')"
    if sorted((matrix_dir / "expression").glob("part-*.parquet")):
        pattern = _sql_path(matrix_dir / "expression" / "part-*.parquet")
        return f"read_parquet('{pattern}', union_by_name := true)"
    return None


def build_package(package: Path, depth: int = TOP_CELLS_DEPTH) -> None:
    from duckdb_util import configure_duckdb_connection, connect_duckdb

    package = package.resolve()
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"missing {manifest_path}")
    matrices_root = package / "matrices"
    sources = {}
    for matrix_dir in sorted(p for p in matrices_root.iterdir() if p.is_dir()):
        source = _expression_source(matrix_dir)
        if source:
            sources[matrix_dir.name] = source
    if not sources:
        raise SystemExit(f"no expression data under {matrices_root}")

    out = package / TOP_CELLS_FILENAME
    tmp = package / f".{TOP_CELLS_FILENAME}.tmp"
    con = connect_duckdb(database=":memory:")
    try:
        configure_duckdb_connection(
            con, memory_limit=os.environ.get("DUCKDB_MEMORY_LIMIT") or "2GB"
        )
        con.execute(
            "CREATE TABLE top_cells (matrix_id VARCHAR, dir VARCHAR, "
            "feature_id VARCHAR, biosample_id VARCHAR, value DOUBLE)"
        )
        for matrix_id, source in sources.items():
            for direction, sql_dir in (("desc", "DESC"), ("asc", "ASC")):
                con.execute(
                    f"""
                    INSERT INTO top_cells
                    SELECT ?, ?, CAST(feature_id AS VARCHAR),
                           CAST(biosample_id AS VARCHAR), CAST(value AS DOUBLE)
                    FROM {source}
                    WHERE value IS NOT NULL
                    ORDER BY value {sql_dir} NULLS LAST, CAST(feature_id AS VARCHAR),
                             CAST(biosample_id AS VARCHAR)
                    LIMIT {int(depth)}
                    """,
                    [matrix_id, direction],
                )
            print(f"  {matrix_id}: top {depth} cells (desc + asc)")
        con.execute(
            f"COPY (SELECT * FROM top_cells ORDER BY matrix_id, dir) TO "
            f"'{_sql_path(tmp)}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        n_rows = int(con.execute("SELECT count(*) FROM top_cells").fetchone()[0])
    finally:
        con.close()
    os.replace(tmp, out)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["expressionTopCells"] = {
        "path": TOP_CELLS_FILENAME,
        "depth": int(depth),
        "rowCount": n_rows,
        "matrices": sorted(sources),
        "note": (
            "Head of the unfiltered value ranking per matrix and direction; "
            "same order as expression_values"
        ),
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {out} rows={n_rows}; updated {manifest_path}")


def main(argv: Optional[list] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    print(f"Building expression top cells in {args.package}")
    build_package(args.package, args.depth)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
