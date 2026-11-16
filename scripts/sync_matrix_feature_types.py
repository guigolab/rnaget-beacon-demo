#!/usr/bin/env python3
"""Sync matrices.json catalogs from per-matrix feature/biosample parquet.

Also ensures the beacon-v2 matrix model fields: ``id``, top-level ``source``
(from manifest.json), projects missing feature biotypes from ``genes.parquet``
into each ``features.parquet``, and drops the legacy ``info`` / ``package`` bags
(packaging metadata lives in manifest.json).

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


def _sql_path(path: Path) -> str:
    return str(path).replace("'", "''")


def project_biotypes_from_genes(package: Path, features_path: Path) -> int:
    """Fill missing feature biotype_id/label from the package ``genes.parquet``.

    Hydration can leave matrix feature rows without a biotype (for example
    NCBI-annotated GEO matrices, or older releases) although ``genes.parquet``
    has it for the same (resource, feature_id). Project it into
    ``features.parquet`` so the matrix ``biotypes`` catalog and the feature
    index see it. Returns the number of rows filled (0 = file left untouched).
    """
    import duckdb

    genes_path = package / "genes.parquet"
    if not genes_path.is_file() or not features_path.is_file():
        return 0
    con = duckdb.connect()
    try:
        cols = {
            r[0]
            for r in con.execute(
                f"describe select * from read_parquet('{_sql_path(features_path)}')"
            ).fetchall()
        }
        f_id = "f.biotype_id" if "biotype_id" in cols else "NULL::VARCHAR"
        f_label = "f.biotype_label" if "biotype_label" in cols else "NULL::VARCHAR"
        genes = (
            "(select feature_id, resource, any_value(biotype_id) biotype_id, "
            "any_value(biotype_label) biotype_label "
            f"from read_parquet('{_sql_path(genes_path)}') "
            "where biotype_id is not null group by feature_id, resource)"
        )
        joined = (
            f"from read_parquet('{_sql_path(features_path)}') f "
            f"left join {genes} g on g.feature_id = f.feature_id "
            "and g.resource = f.resource"
        )
        fillable = con.execute(
            f"select count(*) {joined} where {f_id} is null and g.biotype_id is not null"
        ).fetchone()[0]
        if not fillable:
            return 0
        keep = ", ".join(
            f'f."{c}"'
            for c in [
                r[0]
                for r in con.execute(
                    f"describe select * from read_parquet('{_sql_path(features_path)}')"
                ).fetchall()
            ]
            if c not in ("biotype_id", "biotype_label")
        )
        tmp = features_path.with_suffix(".tmp.parquet")
        con.execute(
            f"copy (select {keep}, coalesce({f_id}, g.biotype_id) as biotype_id, "
            f"coalesce({f_label}, g.biotype_label) as biotype_label {joined}) "
            f"to '{_sql_path(tmp)}' (format parquet, compression zstd)"
        )
    finally:
        con.close()
    tmp.replace(features_path)
    return int(fillable)


def _format_terms(terms: List[Dict[str, str]]) -> str:
    return ", ".join(
        f"{t['id']}" + (f" ({t['label']})" if t.get("label") else "") for t in terms
    )


def matrices_need_catalog_sync(package: Path) -> bool:
    """True when matrices.json still needs the model fields (fetch backfill).

    Flags a missing ``id``/``source``, a leftover ``info``/``package`` bag, or
    missing ``biotypes``/``biosampleTypes`` on a matrix whose features carry
    biotypes after projection (so a settled package is not re-synced).
    """
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
        if "biosampleTypes" not in doc:
            return True
        if not doc.get("id") or not doc.get("source"):
            return True
        if "info" in doc or "package" in doc:
            return True
    return _features_missing_biotypes(package, matrices)


def _features_missing_biotypes(package: Path, matrices: List[Dict[str, Any]]) -> bool:
    """True when a matrix lacks ``biotypes`` although genes.parquet could supply them."""
    manifest_path = package / "manifest.json"
    genes_path = package / "genes.parquet"
    if not manifest_path.is_file() or not genes_path.is_file():
        return False
    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)
    dirs = {
        str(e.get("matrix_id")): str(e.get("dir"))
        for e in manifest.get("matrices") or []
        if e.get("matrix_id") and e.get("dir")
    }
    for doc in matrices:
        if not isinstance(doc, dict) or doc.get("biotypes"):
            continue
        dirname = dirs.get(str(doc.get("matrixId") or doc.get("id") or ""))
        if not dirname:
            continue
        feat = package / "matrices" / dirname / "features.parquet"
        if feat.is_file() and (
            _distinct_biotypes(feat) or _projectable(package, feat)
        ):
            return True
    return False


def _projectable(package: Path, features_path: Path) -> bool:
    import duckdb

    con = duckdb.connect()
    try:
        cols = {
            r[0]
            for r in con.execute(
                f"describe select * from read_parquet('{_sql_path(features_path)}')"
            ).fetchall()
        }
        f_id = "f.biotype_id" if "biotype_id" in cols else "NULL::VARCHAR"
        n = con.execute(
            f"select count(*) from read_parquet('{_sql_path(features_path)}') f "
            f"join (select feature_id, resource from read_parquet("
            f"'{_sql_path(package / 'genes.parquet')}') where biotype_id is not null) g "
            f"on g.feature_id = f.feature_id and g.resource = f.resource "
            f"where {f_id} is null"
        ).fetchone()[0]
        return bool(n)
    finally:
        con.close()


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
    source_by_id: Dict[str, str] = {}
    for entry in manifest.get("matrices") or []:
        mid = entry.get("matrix_id")
        dirname = entry.get("dir")
        if mid and dirname:
            dir_by_id[str(mid)] = str(dirname)
        if mid and entry.get("source"):
            source_by_id[str(mid)] = str(entry["source"])

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

        changed = False
        # beacon-v2 matrix model: ``id`` identifier and top-level ``source``.
        if doc.get("id") != mid:
            doc["id"] = mid
            changed = True
        if not doc.get("source"):
            src = source_by_id.get(mid) or (doc.get("info") or {}).get("profileSource")
            if src:
                doc["source"] = str(src)
                changed = True
                print(f"{mid}: source → {src}")
        # Packaging metadata lives in manifest.json, not in the matrix document.
        for legacy in ("info", "package"):
            if legacy in doc:
                doc.pop(legacy)
                changed = True

        dirname = dir_by_id.get(mid)
        if not dirname:
            if changed:
                updated += 1
            continue
        matrix_dir = package / "matrices" / dirname
        feat_path = matrix_dir / "features.parquet"
        bio_path = matrix_dir / "biosamples.parquet"

        if feat_path.is_file():
            filled = project_biotypes_from_genes(package, feat_path)
            if filled:
                changed = True
                print(f"{mid}: projected biotype onto {filled} feature rows from genes.parquet")
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
        f"Synced id/source/featureTypes/biotypes/biosampleTypes for "
        f"{updated}/{len(matrices)} matrices → {matrices_path}"
    )
    return 0


def main(argv: List[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    return sync_package(args.package.resolve())


if __name__ == "__main__":
    raise SystemExit(main())
