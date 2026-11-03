#!/usr/bin/env python3
"""Set matrices.json featureTypes from distinct SO classes in each matrix's features."""

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
            "Rewrite each matrix's featureTypes to the distinct Sequence Ontology "
            "classes present in that matrix's features.parquet (after hydrate)."
        )
    )
    p.add_argument("--package", type=Path, required=True)
    return p


def _distinct_feature_types(features_path: Path) -> List[Dict[str, str]]:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    schema_names = set(pq.ParquetFile(features_path).schema_arrow.names)
    if "feature_type_id" not in schema_names:
        return []
    cols = ["feature_type_id"]
    has_label = "feature_type_label" in schema_names
    if has_label:
        cols.append("feature_type_label")
    # Project SO columns only (avoid loading full feature rows).
    table = pq.read_table(features_path, columns=cols)
    ids = table.column("feature_type_id")
    mask = pc.and_(pc.is_valid(ids), pc.not_equal(ids, ""))
    table = table.filter(mask)
    if table.num_rows == 0:
        return []

    by_id: Dict[str, Optional[str]] = {}
    id_list = table.column("feature_type_id").to_pylist()
    label_list = (
        table.column("feature_type_label").to_pylist() if has_label else [None] * len(id_list)
    )
    for ft_id, label in zip(id_list, label_list):
        if not ft_id:
            continue
        key = str(ft_id)
        if key not in by_id or (not by_id[key] and label):
            by_id[key] = str(label) if label else None
    out: List[Dict[str, str]] = []
    for ft_id in sorted(by_id):
        term: Dict[str, str] = {"id": ft_id}
        if by_id[ft_id]:
            term["label"] = by_id[ft_id]  # type: ignore[assignment]
        out.append(term)
    return out


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
        feat_path = package / "matrices" / dirname / "features.parquet"
        if not feat_path.is_file():
            continue
        derived = _distinct_feature_types(feat_path)
        if not derived:
            # Keep export seed when hydrate did not populate SO ids yet.
            continue
        if doc.get("featureTypes") != derived:
            doc["featureTypes"] = derived
            updated += 1
            print(
                f"{mid}: featureTypes → "
                + ", ".join(
                    f"{t['id']}" + (f" ({t['label']})" if t.get('label') else "")
                    for t in derived
                )
            )

    with matrices_path.open("w", encoding="utf-8") as fh:
        json.dump(matrices, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Synced featureTypes for {updated}/{len(matrices)} matrices → {matrices_path}")
    return 0


def main(argv: List[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    return sync_package(args.package.resolve())


if __name__ == "__main__":
    raise SystemExit(main())
