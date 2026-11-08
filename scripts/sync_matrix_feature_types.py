#!/usr/bin/env python3
"""Sync matrices.json catalogs from per-matrix feature/biosample parquet.

Rewrites:
  - featureTypes  ← distinct feature_type_id / feature_type_label
  - biotypes      ← distinct biotype_id / biotype_label (when present)
  - biosampleTypes ← distinct ontology_id / ontology_label on biosamples
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Rewrite each matrix's featureTypes, biotypes, and biosampleTypes "
            "from that matrix's features.parquet / biosamples.parquet (after hydrate)."
        )
    )
    p.add_argument("--package", type=Path, required=True)
    return p


def _distinct_ontology_terms(
    path: Path,
    *,
    id_col: str,
    label_col: str,
) -> List[Dict[str, str]]:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    schema_names = set(pq.ParquetFile(path).schema_arrow.names)
    if id_col not in schema_names:
        return []
    cols = [id_col]
    has_label = label_col in schema_names
    if has_label:
        cols.append(label_col)
    table = pq.read_table(path, columns=cols)
    ids = table.column(id_col)
    mask = pc.and_(pc.is_valid(ids), pc.not_equal(ids, ""))
    table = table.filter(mask)
    if table.num_rows == 0:
        return []

    by_id: Dict[str, Optional[str]] = {}
    id_list = table.column(id_col).to_pylist()
    label_list = (
        table.column(label_col).to_pylist() if has_label else [None] * len(id_list)
    )
    for tid, label in zip(id_list, label_list):
        if not tid:
            continue
        key = str(tid)
        if key not in by_id or (not by_id[key] and label):
            by_id[key] = str(label) if label else None
    out: List[Dict[str, str]] = []
    for tid in sorted(by_id):
        term: Dict[str, str] = {"id": tid}
        if by_id[tid]:
            term["label"] = by_id[tid]  # type: ignore[assignment]
        out.append(term)
    return out


def _distinct_feature_types(features_path: Path) -> List[Dict[str, str]]:
    return _distinct_ontology_terms(
        features_path, id_col="feature_type_id", label_col="feature_type_label"
    )


def _distinct_biotypes(features_path: Path) -> List[Dict[str, str]]:
    return _distinct_ontology_terms(
        features_path, id_col="biotype_id", label_col="biotype_label"
    )


def _distinct_biosample_types(biosamples_path: Path) -> List[Dict[str, str]]:
    return _distinct_ontology_terms(
        biosamples_path, id_col="ontology_id", label_col="ontology_label"
    )


def _format_terms(terms: List[Dict[str, str]]) -> str:
    return ", ".join(
        f"{t['id']}" + (f" ({t['label']})" if t.get("label") else "") for t in terms
    )


def matrices_need_catalog_sync(package: Path) -> bool:
    """True when any matrix lacks biotypes or biosampleTypes (fetch backfill)."""
    matrices_path = package / "matrices.json"
    if not matrices_path.is_file():
        return False
    with matrices_path.open(encoding="utf-8") as fh:
        matrices = json.load(fh)
    if not isinstance(matrices, list):
        return False
    for doc in matrices:
        if not isinstance(doc, dict):
            continue
        if "biotypes" not in doc or "biosampleTypes" not in doc:
            return True
    return False


def sync_package(package: Path) -> int:
    matrices_path = package / "matrices.json"
    manifest_path = package / "manifest.json"
    if not matrices_path.is_file():
        raise FileNotFoundError(f"missing {matrices_path}")
    if not manifest_path.is_file():
        raise FileNotFoundError(f"missing {manifest_path}")

    with matrices_path.open(encoding="utf-8") as fh:
        matrices = json.load(fh)
    if not isinstance(matrices, list):
        raise ValueError("matrices.json must be a list")

    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)

    dir_by_id: Dict[str, str] = {}
    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        dirname = entry.get("dir")
        if mid and dirname:
            dir_by_id[str(mid)] = str(dirname)

    updated = 0
    for doc in matrices:
        if not isinstance(doc, dict):
            continue
        mid = str(doc.get("matrixId") or doc.get("id") or "")
        if not mid:
            continue
        # Drop legacy singular key if present.
        if "featureType" in doc and "featureTypes" not in doc:
            legacy = doc.pop("featureType")
            if isinstance(legacy, dict):
                doc["featureTypes"] = [legacy]
            elif isinstance(legacy, list):
                doc["featureTypes"] = legacy
        elif "featureType" in doc:
            doc.pop("featureType", None)

        dirname = dir_by_id.get(mid)
        if not dirname:
            continue
        matrix_dir = package / "matrices" / dirname
        feat_path = matrix_dir / "features.parquet"
        bio_path = matrix_dir / "biosamples.parquet"
        changed = False

        if feat_path.is_file():
            derived_ft = _distinct_feature_types(feat_path)
            if derived_ft and doc.get("featureTypes") != derived_ft:
                doc["featureTypes"] = derived_ft
                changed = True
                print(f"{mid}: featureTypes → {_format_terms(derived_ft)}")

            derived_bt = _distinct_biotypes(feat_path)
            if derived_bt and doc.get("biotypes") != derived_bt:
                doc["biotypes"] = derived_bt
                changed = True
                print(f"{mid}: biotypes → {_format_terms(derived_bt)}")

        if bio_path.is_file():
            derived_bs = _distinct_biosample_types(bio_path)
            if derived_bs and doc.get("biosampleTypes") != derived_bs:
                doc["biosampleTypes"] = derived_bs
                changed = True
                print(f"{mid}: biosampleTypes → {_format_terms(derived_bs)}")

        if changed:
            updated += 1

    with matrices_path.open("w", encoding="utf-8") as fh:
        json.dump(matrices, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(
        f"Synced featureTypes/biotypes/biosampleTypes for "
        f"{updated}/{len(matrices)} matrices → {matrices_path}"
    )
    return 0


def main(argv: List[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    return sync_package(args.package.resolve())


if __name__ == "__main__":
    raise SystemExit(main())
