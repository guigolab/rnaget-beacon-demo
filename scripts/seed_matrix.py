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


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Download + seed RNA-seq matrix into PostgreSQL "
            "(matrices / features / biosamples + expression_values)"
        )
    )
    p.add_argument(
        "--profile",
        help=(
            "Catalog source name (encode|geo|gtex|…). "
            "When a source has multiple matrices, pass --matrix-id."
        ),
    )
    p.add_argument(
        "--config",
        type=Path,
        help="Path to a custom profile YAML or datasets catalog (overrides default catalog)",
    )
    p.add_argument(
        "--matrix-id",
        help="Select / override matrix_id (required when a source has multiple matrices)",
    )
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
        help="Slice: max biosample columns / encode biosamples (0 = no cap)",
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


def _resolve_profile(args: argparse.Namespace) -> tuple[dict, str]:
    from parsers import (
        get_parser,
        list_sources,
        load_profile,
        load_profiles_for_sources,
        profile_source,
    )
    from parsers.base import DATASETS_PATH

    # Ensure parsers are registered
    import parsers.encode  # noqa: F401
    import parsers.geo  # noqa: F401
    import parsers.gtex  # noqa: F401

    known = list_sources() if not args.config else None

    if args.config:
        path = Path(args.config)
        import yaml

        with path.open(encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) or {}
        is_catalog = isinstance(raw, dict) and isinstance(raw.get("profiles"), list)
        if is_catalog:
            if not args.profile and not args.matrix_id:
                raise SystemExit(
                    "Catalog config requires --profile <source> "
                    "(and --matrix-id when that source has multiple matrices)."
                )
            try:
                if args.profile:
                    matches = load_profiles_for_sources([args.profile], path=path)
                    if args.matrix_id:
                        matches = [
                            m for m in matches if m.get("matrix_id") == args.matrix_id
                        ]
                    if not matches:
                        raise SystemExit(
                            f"No catalog record for source={args.profile!r}"
                            + (
                                f" matrix_id={args.matrix_id!r}"
                                if args.matrix_id
                                else ""
                            )
                            + f" in {path}"
                        )
                    if len(matches) > 1:
                        ids = [m.get("matrix_id") for m in matches]
                        raise SystemExit(
                            f"Source {args.profile!r} has multiple matrices {ids}; "
                            "pass --matrix-id to select one."
                        )
                    profile = matches[0]
                else:
                    profile = load_profile(
                        None, path, matrix_id=args.matrix_id
                    )
            except ValueError as exc:
                raise SystemExit(str(exc)) from exc
        else:
            profile = load_profile(args.profile, args.config, matrix_id=None)
    else:
        if not args.profile:
            raise SystemExit("Provide --profile or --config")
        if known is not None and args.profile not in known:
            raise SystemExit(
                f"Unknown source {args.profile!r}. Known: {', '.join(known)}"
            )
        matches = load_profiles_for_sources([args.profile])
        if args.matrix_id:
            by_id = [m for m in matches if m.get("matrix_id") == args.matrix_id]
            if not by_id:
                raise SystemExit(
                    f"No catalog record for source={args.profile!r} "
                    f"matrix_id={args.matrix_id!r} in {DATASETS_PATH}"
                )
            profile = by_id[0]
        elif len(matches) > 1:
            ids = [m.get("matrix_id") for m in matches]
            raise SystemExit(
                f"Source {args.profile!r} has multiple matrices {ids}; "
                "pass --matrix-id to select one."
            )
        elif not matches:
            raise SystemExit(f"No catalog record for source={args.profile!r}")
        else:
            profile = matches[0]

    source = profile_source(profile) or args.profile
    if not source:
        raise SystemExit(
            "Profile YAML must set 'source: geo|encode|gtex' "
            "(or pass --profile with a catalog source)."
        )
    try:
        get_parser(source)
    except KeyError as exc:
        raise SystemExit(str(exc)) from exc
    if not profile.get("matrix_id") and not args.matrix_id:
        raise SystemExit("Profile YAML must set 'matrix_id'.")
    return profile, source


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
    from parsers import get_parser
    from parsers.base import CACHE_DIR, resolve_slice

    profile, source = _resolve_profile(args)
    # Allow forcing matrix_id on a custom single-record --config.
    if args.matrix_id and profile.get("matrix_id") != args.matrix_id:
        profile = dict(profile)
        profile["matrix_id"] = args.matrix_id

    max_genes, max_samples = resolve_slice(profile, args.max_genes, args.max_samples)
    parser = get_parser(source)
    cache_dir = args.cache_dir or CACHE_DIR

    print(
        f"Parsing source={source} matrix_id={profile['matrix_id']} "
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
