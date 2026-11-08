#!/usr/bin/env python3
"""Export FastAPI OpenAPI schema to rnaget-beacon-schema.yaml.

Run from repo root (or any cwd):

  python3 scripts/export_openapi.py

Requires server deps: pip install -r server/requirements.txt
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = REPO_ROOT / "server"
DEFAULT_OUT = REPO_ROOT / "rnaget-beacon-schema.yaml"

HEADER = """\
# Generated from the live FastAPI app (server/app.py).
# Do not hand-edit path definitions — regenerate with:
#   python3 scripts/export_openapi.py
# Interactive docs: GET /docs on the running server.
# Entity payloads reference beacon-schemas/*.json via OpenAPI components.
"""


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Export Beacon OpenAPI YAML")
    p.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output YAML path (default: {DEFAULT_OUT})",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)

    if str(SERVER_DIR) not in sys.path:
        sys.path.insert(0, str(SERVER_DIR))

    try:
        import yaml
    except ImportError as exc:
        raise SystemExit(
            "PyYAML is required: pip install -r server/requirements.txt"
        ) from exc

    from app import app

    schema = app.openapi()
    out: Path = args.out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    body = yaml.safe_dump(
        schema,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
    )
    out.write_text(HEADER + "\n" + body, encoding="utf-8")
    print(f"Wrote {out}")
    paths = list((schema.get("paths") or {}).keys())
    print(f"  openapi={schema.get('openapi')} paths={len(paths)}")
    comps = (schema.get("components") or {}).get("schemas") or {}
    for name in (
        "Matrix",
        "GenomicFeature",
        "Biosample",
        "ExpressionValue",
        "BeaconResultsetsResponse",
    ):
        print(f"  schema {name}: {'yes' if name in comps else 'MISSING'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
