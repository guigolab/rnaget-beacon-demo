#!/usr/bin/env python3
"""Build per-matrix filtering_terms catalogs under filtering_terms/by_matrix/.

Reads only the facet columns needed, in Arrow batches, so full gene/biosample
tables are never materialized as Python dicts.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

SERVER_DIR = SCRIPTS_DIR.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

_BATCH_SIZE = 8192
_EXPRESSION_MIN_N = 10

_FEATURE_COLS = ("feature_type_id", "ontology_terms")
_BIO_ID_COLS = (
    "ontology_id",
    "sample_origin_type_id",
    "biosample_status_id",
    "sample_processing_id",
)
_BIO_LIST_COLS = (
    "phenotypic_ontology_ids",
    "phenotype_ids",
    "measurement_assay_ids",
)
_BIO_ALPHA_COLS = ("sex", "condition", "age_bracket", "timepoint")


def _matrix_unit_scale_label(entry: Dict[str, Any]) -> str:
    """Human-readable unit/scale from matrices.json / manifest entry."""
    unit = None
    scale = None
    # Manifest entries may embed a copy; prefer matrices.json fields when present.
    eus = entry.get("expressionUnitAndScale") or {}
    if isinstance(eus, dict):
        unit = eus.get("unit")
        scale = eus.get("scale")
    if not unit:
        unit = entry.get("unit") or "raw"
    if not scale:
        scale = entry.get("scale") or "linear"
    return f"{unit}, {scale}"


def _expression_matrix_terms(
    *,
    matrix_dir: Path,
    entry: Dict[str, Any],
    n_biosamples: int,
) -> List[Dict[str, Any]]:
    """Continuous / cell-level expression.* terms for one matrix catalog."""
    unit_label = _matrix_unit_scale_label(entry)
    terms: List[Dict[str, Any]] = []

    # Always advertise cell value for drill-down.
    terms.append(
        {
            "type": "alphanumeric",
            "id": "expression.value",
            "label": f"Feature value in the biosample ({unit_label})",
            "scopes": ["expressionValue"],
        }
    )

    if n_biosamples < 1:
        return terms

    feat_stats = matrix_dir / "feature_expression_stats.parquet"
    bio_stats = matrix_dir / "biosample_expression_stats.parquet"
    if feat_stats.is_file() and n_biosamples >= _EXPRESSION_MIN_N:
        terms.extend(
            [
                {
                    "type": "alphanumeric",
                    "id": "expression.median",
                    "label": f"Median expression across the cohort ({unit_label})",
                    "scopes": ["genomicFeature"],
                },
                {
                    "type": "alphanumeric",
                    "id": "expression.mean",
                    "label": f"Mean expression across the cohort ({unit_label})",
                    "scopes": ["genomicFeature"],
                },
                {
                    "type": "alphanumeric",
                    "id": "expression.max",
                    "label": f"Maximum expression ({unit_label})",
                    "scopes": ["genomicFeature"],
                },
                {
                    "type": "alphanumeric",
                    "id": "expression.detectedFraction",
                    "label": "Fraction of cohort biosamples with a non-zero value",
                    "scopes": ["genomicFeature"],
                },
            ]
        )
    if bio_stats.is_file() and n_biosamples >= _EXPRESSION_MIN_N:
        terms.append(
            {
                "type": "alphanumeric",
                "id": "expression.detectedGenes",
                "label": "Number of genes detected in the biosample",
                "scopes": ["biosample"],
            }
        )

    # Percentile files are optional (built at fetch time, not in CI packages).
    if (matrix_dir / "percentile_in_feature.parquet").is_file():
        terms.append(
            {
                "type": "alphanumeric",
                "id": "expression.percentileInFeature",
                "label": "Percentile of value among biosamples for this feature (0–100)",
                "scopes": ["expressionValue"],
            }
        )
    if (matrix_dir / "percentile_in_biosample.parquet").is_file():
        terms.append(
            {
                "type": "alphanumeric",
                "id": "expression.percentileInBiosample",
                "label": "Percentile of value among features in this biosample (0–100)",
                "scopes": ["expressionValue"],
            }
        )
    return terms


def _safe_matrix_filename(matrix_id: str) -> str:
    return str(matrix_id).replace("/", "_")


def _parquet_num_rows(path: Path) -> int:
    import pyarrow.parquet as pq

    meta = pq.ParquetFile(path).metadata
    return int(meta.num_rows) if meta is not None else 0


def _iter_column_batches(path: Path, columns: List[str], batch_size: int = _BATCH_SIZE):
    import pyarrow.parquet as pq

    if not columns:
        return
    pf = pq.ParquetFile(path)
    yield from pf.iter_batches(columns=columns, batch_size=batch_size)


def _add_scalar_column(present: Set[str], column) -> None:
    if column is None:
        return
    for val in column.to_pylist():
        if val is not None and str(val).strip():
            present.add(str(val))


def _add_list_column(present: Set[str], column) -> None:
    if column is None:
        return
    for cell in column.to_pylist():
        if not cell:
            continue
        for item in cell:
            if item is None:
                continue
            if isinstance(item, dict):
                tid = item.get("id")
                if tid:
                    present.add(str(tid))
            elif str(item).strip():
                present.add(str(item))


def _add_ontology_terms_column(present: Set[str], column) -> None:
    if column is None:
        return
    for cell in column.to_pylist():
        if not cell:
            continue
        for term in cell:
            if isinstance(term, dict) and term.get("id"):
                present.add(str(term["id"]))
            elif isinstance(term, str) and term.strip():
                present.add(term)


def _feature_present_from_parquet(path: Path) -> Tuple[Set[str], bool]:
    import pyarrow.parquet as pq

    if not path.is_file():
        return set(), False
    has_rows = _parquet_num_rows(path) > 0
    names = set(pq.read_schema(path).names)
    cols = [c for c in _FEATURE_COLS if c in names]
    present: Set[str] = set()
    for batch in _iter_column_batches(path, cols):
        if "feature_type_id" in batch.schema.names:
            _add_scalar_column(present, batch.column("feature_type_id"))
        if "ontology_terms" in batch.schema.names:
            _add_ontology_terms_column(present, batch.column("ontology_terms"))
    return present, has_rows


def _biosample_facets_from_parquet(
    path: Path,
) -> Tuple[Set[str], Dict[str, Set[str]], bool]:
    import pyarrow.parquet as pq

    if not path.is_file():
        return set(), {}, False
    has_rows = _parquet_num_rows(path) > 0
    names = set(pq.read_schema(path).names)
    cols = [
        c
        for c in (*_BIO_ID_COLS, *_BIO_LIST_COLS, *_BIO_ALPHA_COLS)
        if c in names
    ]
    present: Set[str] = set()
    alphanumeric: Dict[str, Set[str]] = {}
    for batch in _iter_column_batches(path, cols):
        schema_names = set(batch.schema.names)
        for col in _BIO_ID_COLS:
            if col in schema_names:
                _add_scalar_column(present, batch.column(col))
        for col in _BIO_LIST_COLS:
            if col in schema_names:
                _add_list_column(present, batch.column(col))
        for col in _BIO_ALPHA_COLS:
            if col not in schema_names:
                continue
            for val in batch.column(col).to_pylist():
                if val is not None and str(val).strip():
                    alphanumeric.setdefault(col, set()).add(str(val))
    return present, alphanumeric, has_rows


def _matrix_feature_type_ids(matrix_entry: Dict[str, Any]) -> Set[str]:
    ids: Set[str] = set()
    for ft in matrix_entry.get("featureType") or []:
        if isinstance(ft, dict) and ft.get("id"):
            ids.add(str(ft["id"]))
    return ids


def _load_matrices_by_id(package: Path) -> Dict[str, Dict[str, Any]]:
    path = package / "matrices.json"
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as fh:
        rows = json.load(fh)
    if not isinstance(rows, list):
        return {}
    return {
        str(m.get("matrixId")): m
        for m in rows
        if isinstance(m, dict) and m.get("matrixId")
    }


def _build_one_matrix_doc(
    *,
    package: Path,
    entry: Dict[str, Any],
    global_terms: List[Dict[str, Any]],
    global_resources: List[Dict[str, Any]],
    matrices_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Optional[Tuple[str, Dict[str, Any]]]:
    from beacon.matrix_axis_catalog import (
        _subset_terms,
        merge_matrix_scoped_filtering_terms,
    )

    matrix_id = str(entry.get("matrix_id") or "").strip()
    dirname = entry.get("dir")
    if not matrix_id or not dirname:
        return None

    matrix_dir = package / "matrices" / dirname
    feat_path = matrix_dir / "features.parquet"
    bio_path = matrix_dir / "biosamples.parquet"

    feat_present, has_features = _feature_present_from_parquet(feat_path)
    feat_present |= _matrix_feature_type_ids(entry)
    feat_terms, feat_resources = _subset_terms(
        global_terms,
        global_resources,
        present_ids=feat_present,
        alphanumeric={},
        scope="genomicFeature",
        keep_symbol_resource=has_features,
    )

    bio_present, bio_alpha, _has_bios = _biosample_facets_from_parquet(bio_path)
    bio_terms, bio_resources = _subset_terms(
        global_terms,
        global_resources,
        present_ids=bio_present,
        alphanumeric=bio_alpha,
        scope="biosample",
        keep_symbol_resource=False,
    )
    terms, resources = merge_matrix_scoped_filtering_terms(
        feat_terms, feat_resources, bio_terms, bio_resources
    )

    n_biosamples = _parquet_num_rows(bio_path) if bio_path.is_file() else 0
    # Drop root categorical expression.* terms when the matrix is too small
    # for bands/profiles (n < MIN_N). Continuous terms are re-added below.
    if n_biosamples < _EXPRESSION_MIN_N:
        terms = [
            t
            for t in terms
            if not str(t.get("id") or "").startswith("expression.")
        ]

    matrix_meta = (matrices_by_id or {}).get(matrix_id) or {}
    # Prefer matrices.json unit/scale; fall back to manifest entry fields.
    unit_entry = {**entry, **matrix_meta}
    expr_terms = _expression_matrix_terms(
        matrix_dir=matrix_dir,
        entry=unit_entry,
        n_biosamples=n_biosamples,
    )
    # Append expression terms (dedupe by id).
    seen = {str(t.get("id")) for t in terms}
    for term in expr_terms:
        tid = str(term.get("id") or "")
        if not tid or tid in seen:
            continue
        terms.append(term)
        seen.add(tid)

    return matrix_id, {
        "schemaVersion": 1,
        "matrixId": matrix_id,
        "resources": resources,
        "filteringTerms": terms,
    }


def build_matrix_catalog(
    package: Path,
    *,
    root_catalog: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Return matrix_id -> filtering_terms document (test/helper API)."""
    if root_catalog is None:
        ft_path = package / "filtering_terms.json"
        if not ft_path.is_file():
            raise SystemExit(f"Missing {ft_path}; build root filtering_terms first")
        with ft_path.open(encoding="utf-8") as fh:
            root_catalog = json.load(fh)

    global_terms = list(root_catalog.get("filteringTerms") or [])
    global_resources = list(root_catalog.get("resources") or [])
    matrices_by_id = _load_matrices_by_id(package)

    manifest_path = package / "manifest.json"
    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)

    out: Dict[str, Dict[str, Any]] = {}
    for entry in manifest.get("matrices") or []:
        built = _build_one_matrix_doc(
            package=package,
            entry=entry,
            global_terms=global_terms,
            global_resources=global_resources,
            matrices_by_id=matrices_by_id,
        )
        if built is None:
            continue
        matrix_id, doc = built
        out[matrix_id] = doc
    return out


def write_matrix_catalogs(
    package: Path,
    catalogs: Optional[Dict[str, Dict[str, Any]]] = None,
    *,
    root_catalog: Optional[Dict[str, Any]] = None,
) -> Path:
    """Write per-matrix catalogs. Prefer streaming build when catalogs is None."""
    out_dir = package / "filtering_terms" / "by_matrix"
    staging = package / "filtering_terms" / f".by_matrix.staging-{os.getpid()}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    count = 0
    try:
        if catalogs is not None:
            items: Iterable[Tuple[str, Dict[str, Any]]] = catalogs.items()
            for matrix_id, doc in items:
                path = staging / f"{_safe_matrix_filename(matrix_id)}.json"
                with path.open("w", encoding="utf-8") as fh:
                    json.dump(doc, fh, indent=2)
                    fh.write("\n")
                count += 1
        else:
            if root_catalog is None:
                ft_path = package / "filtering_terms.json"
                if not ft_path.is_file():
                    raise SystemExit(
                        f"Missing {ft_path}; build root filtering_terms first"
                    )
                with ft_path.open(encoding="utf-8") as fh:
                    root_catalog = json.load(fh)
            global_terms = list(root_catalog.get("filteringTerms") or [])
            global_resources = list(root_catalog.get("resources") or [])
            matrices_by_id = _load_matrices_by_id(package)
            manifest_path = package / "manifest.json"
            with manifest_path.open(encoding="utf-8") as fh:
                manifest = json.load(fh)
            for entry in manifest.get("matrices") or []:
                built = _build_one_matrix_doc(
                    package=package,
                    entry=entry,
                    global_terms=global_terms,
                    global_resources=global_resources,
                    matrices_by_id=matrices_by_id,
                )
                if built is None:
                    continue
                matrix_id, doc = built
                path = staging / f"{_safe_matrix_filename(matrix_id)}.json"
                with path.open("w", encoding="utf-8") as fh:
                    json.dump(doc, fh, indent=2)
                    fh.write("\n")
                count += 1

        if out_dir.exists():
            shutil.rmtree(out_dir)
        staging.rename(out_dir)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    manifest_path = package / "manifest.json"
    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)
    manifest["matrixFilteringTermsPath"] = "filtering_terms/by_matrix"
    manifest["matrixFilteringTerms"] = {"matrixCount": count}
    with manifest_path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(f"Wrote {count} matrix filtering_terms under {out_dir}")
    return out_dir


def build_all_filtering_terms(package: Path) -> None:
    """Build root filtering_terms.json and per-matrix catalogs."""
    from build_filtering_terms import build_catalog, write_catalog

    catalog = build_catalog(package)
    write_catalog(package, catalog)
    write_matrix_catalogs(package, root_catalog=catalog)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Build per-matrix Beacon filtering_terms catalogs"
    )
    p.add_argument("--package", type=Path, required=True)
    p.add_argument(
        "--with-root",
        action="store_true",
        help="Also rebuild root filtering_terms.json before per-matrix catalogs",
    )
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    package = args.package
    if not package.is_dir():
        print(f"Package not found: {package}", file=sys.stderr)
        return 1
    if args.with_root:
        build_all_filtering_terms(package)
    else:
        write_matrix_catalogs(package)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
