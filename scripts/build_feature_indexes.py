#!/usr/bin/env python3
"""Build package-root feature/biosample index parquets for fast global queries."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Build feature_ontology / feature_index / feature_matrix "
        "+ global biosample indexes for a Parquet data package"
    )
    p.add_argument("--package", type=Path, required=True)
    return p


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    try:
        if hasattr(value, "tolist"):
            return list(value.tolist())
    except Exception:
        pass
    return [value]


def build_indexes(package: Path) -> Dict[str, int]:
    import pyarrow as pa
    import pyarrow.parquet as pq

    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Missing {manifest_path}")
    with manifest_path.open(encoding="utf-8") as fh:
        manifest: Dict[str, Any] = json.load(fh)

    # feature_id / wrapper_id -> index row (first wins)
    index_by_wrapper: Dict[str, Dict[str, Any]] = {}
    # (feature_id, ontology_id, role) -> ontology row
    ontology_seen: Set[Tuple[str, str, str]] = set()
    ontology_rows: List[Dict[str, Any]] = []
    matrix_rows: List[Dict[str, Any]] = []
    matrix_seen: Set[Tuple[str, str]] = set()

    bio_by_id: Dict[str, Dict[str, Any]] = {}
    bio_matrix_rows: List[Dict[str, Any]] = []
    bio_matrix_seen: Set[Tuple[str, str]] = set()

    feat_cols = [
        "feature_id",
        "wrapper_id",
        "resource",
        "symbol",
        "aliases",
        "xrefs",
        "feature_type_id",
        "feature_type_label",
        "ontology_terms",
        "chrom",
        "start",
        "end",
        "strand",
        "matrix_id",
    ]

    for entry in manifest.get("matrices") or []:
        dirname = entry.get("dir")
        mid = entry.get("matrix_id")
        if not dirname or not mid:
            continue
        feat_path = package / "matrices" / dirname / "features.parquet"
        if feat_path.is_file():
            names = set(pq.read_schema(feat_path).names)
            cols = [c for c in feat_cols if c in names]
            table = pq.read_table(feat_path, columns=cols)
            for row in table.to_pylist():
                fid = str(row.get("feature_id") or "")
                wid = str(row.get("wrapper_id") or f"feature-{fid}")
                if not fid:
                    continue
                matrix_id = str(row.get("matrix_id") or mid)
                mkey = (wid, matrix_id)
                if mkey not in matrix_seen:
                    matrix_seen.add(mkey)
                    matrix_rows.append(
                        {
                            "wrapper_id": wid,
                            "feature_id": fid,
                            "matrix_id": matrix_id,
                        }
                    )
                if wid not in index_by_wrapper:
                    index_by_wrapper[wid] = {
                        "wrapper_id": wid,
                        "feature_id": fid,
                        "resource": row.get("resource"),
                        "symbol": row.get("symbol"),
                        "aliases": list(_as_list(row.get("aliases"))),
                        "xrefs": list(_as_list(row.get("xrefs"))),
                        "feature_type_id": row.get("feature_type_id"),
                        "feature_type_label": row.get("feature_type_label"),
                        "ontology_terms": [
                            {"id": t.get("id"), "label": t.get("label")}
                            for t in _as_list(row.get("ontology_terms"))
                            if isinstance(t, dict) and t.get("id")
                        ],
                        "chrom": row.get("chrom"),
                        "start": row.get("start"),
                        "end": row.get("end"),
                        "strand": row.get("strand"),
                    }
                # Ontology edges
                ft_id = row.get("feature_type_id")
                if ft_id:
                    okey = (fid, str(ft_id), "feature_type")
                    if okey not in ontology_seen:
                        ontology_seen.add(okey)
                        ontology_rows.append(
                            {
                                "feature_id": fid,
                                "wrapper_id": wid,
                                "ontology_id": str(ft_id),
                                "ontology_label": (
                                    str(row["feature_type_label"])
                                    if row.get("feature_type_label") is not None
                                    else None
                                ),
                                "role": "feature_type",
                            }
                        )
                for term in _as_list(row.get("ontology_terms")):
                    if not isinstance(term, dict) or not term.get("id"):
                        continue
                    tid = str(term["id"])
                    okey = (fid, tid, "biotype")
                    if okey in ontology_seen:
                        continue
                    ontology_seen.add(okey)
                    ontology_rows.append(
                        {
                            "feature_id": fid,
                            "wrapper_id": wid,
                            "ontology_id": tid,
                            "ontology_label": (
                                str(term["label"]) if term.get("label") else None
                            ),
                            "role": "biotype",
                        }
                    )
            del table

        bio_path = package / "matrices" / dirname / "biosamples.parquet"
        if bio_path.is_file():
            bio_names = set(pq.read_schema(bio_path).names)
            bio_want = [
                c
                for c in (
                    "biosample_id",
                    "matrix_id",
                    "ontology_id",
                    "ontology_label",
                    "ontology_source",
                    "sex",
                    "donor",
                    "summary",
                    "lab",
                    "sample_origin_type_id",
                    "sample_origin_type_label",
                )
                if c in bio_names
            ]
            bio_table = pq.read_table(bio_path, columns=bio_want)
            for row in bio_table.to_pylist():
                bid = str(row.get("biosample_id") or "")
                if not bid:
                    continue
                matrix_id = str(row.get("matrix_id") or mid)
                bkey = (bid, matrix_id)
                if bkey not in bio_matrix_seen:
                    bio_matrix_seen.add(bkey)
                    bio_matrix_rows.append(
                        {"biosample_id": bid, "matrix_id": matrix_id}
                    )
                if bid not in bio_by_id:
                    bio_by_id[bid] = {
                        "biosample_id": bid,
                        "ontology_id": row.get("ontology_id"),
                        "ontology_label": row.get("ontology_label"),
                        "ontology_source": row.get("ontology_source"),
                        "sex": row.get("sex"),
                        "donor": row.get("donor"),
                        "summary": row.get("summary"),
                        "lab": row.get("lab"),
                        "sample_origin_type_id": row.get("sample_origin_type_id"),
                        "sample_origin_type_label": row.get(
                            "sample_origin_type_label"
                        ),
                    }
            del bio_table

    index_rows = sorted(index_by_wrapper.values(), key=lambda r: r["wrapper_id"])
    bio_rows = sorted(bio_by_id.values(), key=lambda r: r["biosample_id"])

    out_paths = {
        "feature_ontology": package / "feature_ontology.parquet",
        "feature_index": package / "feature_index.parquet",
        "feature_matrix": package / "feature_matrix.parquet",
        "biosamples": package / "biosamples.parquet",
        "biosample_matrix": package / "biosample_matrix.parquet",
    }

    pq.write_table(
        pa.Table.from_pylist(ontology_rows)
        if ontology_rows
        else pa.table(
            {
                "feature_id": pa.array([], type=pa.string()),
                "wrapper_id": pa.array([], type=pa.string()),
                "ontology_id": pa.array([], type=pa.string()),
                "ontology_label": pa.array([], type=pa.string()),
                "role": pa.array([], type=pa.string()),
            }
        ),
        out_paths["feature_ontology"],
        compression="zstd",
    )
    if index_rows:
        index_table = pa.Table.from_pylist(index_rows)
    else:
        index_table = pa.table(
            {
                "wrapper_id": pa.array([], type=pa.string()),
                "feature_id": pa.array([], type=pa.string()),
                "resource": pa.array([], type=pa.string()),
                "symbol": pa.array([], type=pa.string()),
                "aliases": pa.array([], type=pa.list_(pa.string())),
                "xrefs": pa.array([], type=pa.list_(pa.string())),
                "feature_type_id": pa.array([], type=pa.string()),
                "feature_type_label": pa.array([], type=pa.string()),
                "ontology_terms": pa.array(
                    [],
                    type=pa.list_(
                        pa.struct(
                            [
                                ("id", pa.string()),
                                ("label", pa.string()),
                            ]
                        )
                    ),
                ),
                "chrom": pa.array([], type=pa.string()),
                "start": pa.array([], type=pa.int64()),
                "end": pa.array([], type=pa.int64()),
                "strand": pa.array([], type=pa.string()),
            }
        )
    pq.write_table(index_table, out_paths["feature_index"], compression="zstd")
    pq.write_table(
        pa.Table.from_pylist(matrix_rows)
        if matrix_rows
        else pa.table(
            {
                "wrapper_id": pa.array([], type=pa.string()),
                "feature_id": pa.array([], type=pa.string()),
                "matrix_id": pa.array([], type=pa.string()),
            }
        ),
        out_paths["feature_matrix"],
        compression="zstd",
    )
    if bio_rows:
        bio_table = pa.Table.from_pylist(bio_rows)
    else:
        bio_table = pa.table(
            {
                "biosample_id": pa.array([], type=pa.string()),
                "ontology_id": pa.array([], type=pa.string()),
                "ontology_label": pa.array([], type=pa.string()),
                "ontology_source": pa.array([], type=pa.string()),
                "sex": pa.array([], type=pa.string()),
                "donor": pa.array([], type=pa.string()),
                "summary": pa.array([], type=pa.string()),
                "lab": pa.array([], type=pa.string()),
                "sample_origin_type_id": pa.array([], type=pa.string()),
                "sample_origin_type_label": pa.array([], type=pa.string()),
            }
        )
    pq.write_table(bio_table, out_paths["biosamples"], compression="zstd")
    pq.write_table(
        pa.Table.from_pylist(bio_matrix_rows)
        if bio_matrix_rows
        else pa.table(
            {
                "biosample_id": pa.array([], type=pa.string()),
                "matrix_id": pa.array([], type=pa.string()),
            }
        ),
        out_paths["biosample_matrix"],
        compression="zstd",
    )

    manifest["featureOntologyPath"] = "feature_ontology.parquet"
    manifest["featureIndexPath"] = "feature_index.parquet"
    manifest["featureMatrixPath"] = "feature_matrix.parquet"
    manifest["biosamplesPath"] = "biosamples.parquet"
    manifest["biosampleMatrixPath"] = "biosample_matrix.parquet"
    manifest["features"] = {
        **(manifest.get("features") or {}),
        "numUnique": len(index_rows),
        "ontologyRows": len(ontology_rows),
        "matrixLinks": len(matrix_rows),
    }
    manifest["biosamples"] = {
        **(manifest.get("biosamples") or {}),
        "numUnique": len(bio_rows),
        "matrixLinks": len(bio_matrix_rows),
    }
    with manifest_path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(
        f"feature indexes: index={len(index_rows)} ontology={len(ontology_rows)} "
        f"feature_matrix={len(matrix_rows)} biosamples={len(bio_rows)} "
        f"biosample_matrix={len(bio_matrix_rows)}"
    )
    return {
        "features": len(index_rows),
        "ontology": len(ontology_rows),
        "biosamples": len(bio_rows),
    }


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        build_indexes(args.package)
        return 0
    except SystemExit:
        raise
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
