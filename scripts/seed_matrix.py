#!/usr/bin/env python3
"""Download a matrix via a parser profile and seed PostgreSQL (metadata + expression)."""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

# Allow `python scripts/seed_matrix.py` from repo root or scripts/
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

KNOWN_PROFILES = ("geo", "encode", "gtex")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Download + seed RNA-seq matrix into PostgreSQL "
            "(matrices / features / biosamples + expression_values)"
        )
    )
    p.add_argument(
        "--profile",
        choices=list(KNOWN_PROFILES),
        help="Built-in profile name under scripts/profiles/",
    )
    p.add_argument(
        "--config",
        type=Path,
        help="Path to a custom profile YAML (overrides --profile path)",
    )
    p.add_argument("--matrix-id", help="Override profile matrix_id")
    p.add_argument(
        "--max-genes",
        type=int,
        default=None,
        help="Slice: max feature rows (0 = no cap; default from profile)",
    )
    p.add_argument(
        "--max-samples",
        type=int,
        default=None,
        help="Slice: max biosample columns (0 = no cap; unused for encode)",
    )
    p.add_argument(
        "--skip-download",
        action="store_true",
        help="Use scripts/.cache only (fail if missing)",
    )
    p.add_argument(
        "--meta-only",
        action="store_true",
        help="Seed metadata tables only (matrices, features, biosamples)",
    )
    p.add_argument(
        "--expression-only",
        action="store_true",
        help="Seed expression_values only",
    )
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Download cache directory (default: scripts/.cache)",
    )
    p.add_argument(
        "--verbose",
        action="store_true",
        help="Print full tracebacks on failure",
    )
    return p


def _validate_profile(profile: dict, profile_name: str | None) -> str:
    if not profile_name:
        raise SystemExit(
            "Profile YAML must set 'profile: geo|encode|gtex' "
            "(or pass --profile with a built-in name)."
        )
    if profile_name not in KNOWN_PROFILES:
        raise SystemExit(
            f"Unknown profile {profile_name!r}. Known: {', '.join(KNOWN_PROFILES)}"
        )
    if not profile.get("matrix_id"):
        raise SystemExit("Profile YAML must set 'matrix_id'.")
    return profile_name


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    if not args.profile and not args.config:
        build_arg_parser().error("Provide --profile or --config")
    if args.meta_only and args.expression_only:
        build_arg_parser().error("Use only one of --meta-only / --expression-only")

    try:
        return _run(args)
    except SystemExit:
        raise
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        if args.verbose:
            traceback.print_exc()
        return 1


def _run(args: argparse.Namespace) -> int:
    # Lazy imports so --help works before deps are installed
    from db import postgres as pg_db
    from parsers import get_parser, load_profile
    from parsers.base import CACHE_DIR, resolve_slice
    import parsers.encode  # noqa: F401
    import parsers.geo  # noqa: F401
    import parsers.gtex  # noqa: F401

    profile = load_profile(args.profile, args.config)
    profile_name = _validate_profile(
        profile, profile.get("profile") or args.profile
    )
    if args.matrix_id:
        profile["matrix_id"] = args.matrix_id

    max_genes, max_samples = resolve_slice(profile, args.max_genes, args.max_samples)
    parser = get_parser(profile_name)
    cache_dir = args.cache_dir or CACHE_DIR

    print(
        f"Parsing profile={profile_name} matrix_id={profile['matrix_id']} "
        f"max_genes={max_genes} max_samples={max_samples}"
    )
    normalized = parser(
        profile,
        cache_dir,
        max_genes,
        max_samples,
        skip_download=args.skip_download,
    )

    dims = normalized.matrix.get("dimensions") or {}
    expected = (normalized.matrix.get("info") or {}).get("expectedExpressionCells")
    streaming = (normalized.matrix.get("info") or {}).get("expressionStreaming")
    cells_msg = (
        f"expression_cells~{expected} (streaming)"
        if streaming and expected is not None
        else (
            f"expression_cells≤{expected}"
            if expected is not None
            else "expression_cells=streaming"
        )
    )
    print(
        f"Normalized: features={len(normalized.features)} "
        f"biosamples={len(normalized.biosamples)} "
        f"dims={dims.get('features')}x{dims.get('biosamples')} "
        f"{cells_msg}"
    )

    do_meta = not args.expression_only
    do_expr = not args.meta_only
    matrix_id = normalized.matrix["matrixId"]

    with pg_db.connect() as conn:
        pg_db.ensure_schema(conn)

        if do_meta:
            print("Seeding PostgreSQL metadata…")
            stats = pg_db.seed_metadata(
                conn,
                matrix=normalized.matrix,
                features=normalized.features,
                biosamples=normalized.biosamples,
            )
            print(f"  Metadata upserted: {stats}")

        if do_expr:
            print("Seeding PostgreSQL expression_values…")
            n = pg_db.seed_expression_values(
                conn,
                normalized.expression_rows,
                matrix_id=matrix_id,
            )
            print(f"  Expression rows loaded: {n}")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
