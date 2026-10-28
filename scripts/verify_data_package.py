#!/usr/bin/env python3
"""Post-export checks for a Parquet data package (manifest, parts, matrix schema)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Verify an exported Parquet data package")
    p.add_argument(
        "--package",
        type=Path,
        required=True,
        help="Path to data-package directory (contains manifest.json)",
    )
    return p


def main(argv: List[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    root: Path = args.package
    errors: List[str] = []

    manifest_path = root / "manifest.json"
    matrices_path = root / "matrices.json"
    if not manifest_path.is_file():
        errors.append("missing manifest.json")
    if not matrices_path.is_file():
        errors.append("missing matrices.json")
    if errors:
        print("Package verify failed:", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        return 1

    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)
    with matrices_path.open(encoding="utf-8") as fh:
        matrices = json.load(fh)

    if not isinstance(matrices, list) or not matrices:
        errors.append("matrices.json must be a non-empty list")

    from export_parquet import validate_matrices

    try:
        validate_matrices(matrices)
    except SystemExit as exc:
        errors.append(str(exc))

    by_id = {m.get("matrixId"): m for m in matrices if isinstance(m, dict)}
    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        dirname = entry.get("dir")
        if not mid or not dirname:
            errors.append(f"manifest matrix entry incomplete: {entry!r}")
            continue
        matrix_dir = root / "matrices" / dirname
        for name in ("features.parquet", "biosamples.parquet"):
            if not (matrix_dir / name).is_file():
                errors.append(f"{mid}: missing {name}")
        expr = matrix_dir / "expression"
        parts = sorted(expr.glob("part-*.parquet")) if expr.is_dir() else []
        if not parts:
            errors.append(f"{mid}: no expression/part-*.parquet files")
        doc = by_id.get(mid)
        if doc is None:
            errors.append(f"{mid}: listed in manifest but missing from matrices.json")
        elif not (doc.get("annotation") or {}).get("file"):
            errors.append(f"{mid}: annotation.file missing")

    if errors:
        print("Package verify failed:", file=sys.stderr)
        for e in errors[:40]:
            print(f"  {e}", file=sys.stderr)
        if len(errors) > 40:
            print(f"  … and {len(errors) - 40} more", file=sys.stderr)
        return 1

    print(
        f"Package OK: {len(matrices)} matrix(es), "
        f"manifest schemaVersion={manifest.get('schemaVersion')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
