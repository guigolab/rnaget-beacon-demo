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


def _check_stats_parquet(
    matrix_id: str,
    path: Path,
    *,
    id_col: str,
    label: str,
) -> List[str]:
    """Require readable, non-empty stats parquet with expected columns."""
    import pyarrow.parquet as pq

    errs: List[str] = []
    try:
        table = pq.read_table(path)
    except Exception as exc:  # noqa: BLE001 — surface any read failure
        return [f"{matrix_id}: {label} unreadable: {exc}"]
    if table.num_rows <= 0:
        errs.append(f"{matrix_id}: {label} has zero rows")
    cols = set(table.column_names)
    for required in (id_col, "min_value", "max_value"):
        if required not in cols:
            errs.append(f"{matrix_id}: {label} missing column {required}")
    return errs


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
        for name in (
            "features.parquet",
            "biosamples.parquet",
            "feature_expression_stats.parquet",
            "biosample_expression_stats.parquet",
        ):
            if not (matrix_dir / name).is_file():
                errors.append(f"{mid}: missing {name}")
        feat_stats = matrix_dir / "feature_expression_stats.parquet"
        bio_stats = matrix_dir / "biosample_expression_stats.parquet"
        if feat_stats.is_file():
            errors.extend(
                _check_stats_parquet(
                    mid,
                    feat_stats,
                    id_col="feature_id",
                    label="feature_expression_stats",
                )
            )
        if bio_stats.is_file():
            errors.extend(
                _check_stats_parquet(
                    mid,
                    bio_stats,
                    id_col="biosample_id",
                    label="biosample_expression_stats",
                )
            )
        merged_expr = matrix_dir / "expression.parquet"
        expr = matrix_dir / "expression"
        parts = sorted(expr.glob("part-*.parquet")) if expr.is_dir() else []
        if not merged_expr.is_file() and not parts:
            errors.append(
                f"{mid}: missing expression.parquet and expression/part-*.parquet"
            )
        doc = by_id.get(mid)
        if doc is None:
            errors.append(f"{mid}: listed in manifest but missing from matrices.json")
        else:
            if not (doc.get("annotation") or {}).get("file"):
                errors.append(f"{mid}: annotation.file missing")
            evr = doc.get("expressionValueRange")
            if not isinstance(evr, dict) or "min" not in evr or "max" not in evr:
                errors.append(f"{mid}: matrices.json missing expressionValueRange.min/max")

    genes_path = root / "genes.parquet"
    lookup_path = root / "gene_lookup.parquet"
    if not genes_path.is_file():
        errors.append("missing genes.parquet")
    if not lookup_path.is_file():
        errors.append("missing gene_lookup.parquet")

    if genes_path.is_file() and lookup_path.is_file():
        import pyarrow.parquet as pq

        genes_table = pq.read_table(genes_path)
        lookup_table = pq.read_table(lookup_path)
        if genes_table.num_rows <= 0:
            errors.append("genes.parquet has zero rows")
        if lookup_table.num_rows <= 0:
            errors.append("gene_lookup.parquet has zero rows")
        if "lookup_kind" in lookup_table.column_names:
            kinds = set(lookup_table.column("lookup_kind").to_pylist())
            if "symbol" not in kinds:
                errors.append("gene_lookup.parquet has no lookup_kind=symbol rows")
        gene_ids = set(genes_table.column("feature_id").to_pylist())
        lookup_ids = set(lookup_table.column("feature_id").to_pylist())
        orphan = lookup_ids - gene_ids
        if orphan:
            sample = sorted(orphan)[:5]
            errors.append(
                f"gene_lookup feature_id(s) missing from genes: {sample}"
                + (f" (+{len(orphan) - 5} more)" if len(orphan) > 5 else "")
            )
        if manifest.get("genesPath") != "genes.parquet":
            errors.append("manifest.genesPath missing or not genes.parquet")
        if manifest.get("geneLookupPath") != "gene_lookup.parquet":
            errors.append("manifest.geneLookupPath missing or not gene_lookup.parquet")
        genes_meta = manifest.get("genes")
        if isinstance(genes_meta, dict) and "rows" in genes_meta:
            declared = genes_meta.get("rows")
            if declared != genes_table.num_rows:
                errors.append(
                    f"manifest.genes.rows={declared} != genes.parquet rows={genes_table.num_rows}"
                )
        if isinstance(genes_meta, dict) and "lookupRows" in genes_meta:
            declared_lookup = genes_meta.get("lookupRows")
            if declared_lookup != lookup_table.num_rows:
                errors.append(
                    f"manifest.genes.lookupRows={declared_lookup} "
                    f"!= gene_lookup.parquet rows={lookup_table.num_rows}"
                )

        gene_cols = set(genes_table.column_names)
        for required in (
            "feature_type_id",
            "feature_type_label",
            "xrefs",
            "ontology_terms",
            "annotation_source",
            "symbol",
        ):
            if required not in gene_cols:
                errors.append(f"genes.parquet missing column {required}")

        if "annotation_source" in gene_cols and "xrefs" in gene_cols:
            rows = genes_table.select(
                ["annotation_source", "symbol", "xrefs", "ontology_terms", "feature_type_id"]
            ).to_pylist()

            def _xref_has_gene_or_hgnc(xrefs: object) -> bool:
                if not xrefs:
                    return False
                for x in xrefs:
                    s = str(x)
                    if s.startswith("NCBIGene:") or s.startswith("HGNC:"):
                        return True
                return False

            gencode_with_symbol = [
                r
                for r in rows
                if (r.get("annotation_source") or "").lower() == "gencode" and r.get("symbol")
            ]
            if gencode_with_symbol:
                hits = sum(1 for r in gencode_with_symbol if _xref_has_gene_or_hgnc(r.get("xrefs")))
                frac = hits / len(gencode_with_symbol)
                if frac < 0.5:
                    errors.append(
                        f"gencode symbol-bearing genes with NCBIGene/HGNC xref "
                        f"fraction={frac:.1%} < 50% ({hits}/{len(gencode_with_symbol)})"
                    )

            ncbigene_rows = [
                r for r in rows if (r.get("annotation_source") or "").lower() == "ncbigene"
            ]
            if ncbigene_rows:
                missing_ncbi = [
                    r
                    for r in ncbigene_rows
                    if not any(
                        str(x).startswith("NCBIGene:") for x in (r.get("xrefs") or [])
                    )
                ]
                if missing_ncbi:
                    errors.append(
                        f"ncbigene genes missing NCBIGene xref: {len(missing_ncbi)} "
                        f"(e.g. feature_id={missing_ncbi[0].get('feature_id')})"
                    )

            # Ontology terms should diversify when biotypes vary across the package.
            ont_ids = set()
            nonempty_ont = 0
            for r in rows:
                terms = r.get("ontology_terms") or []
                if terms:
                    nonempty_ont += 1
                    for t in terms:
                        if isinstance(t, dict) and t.get("id"):
                            ont_ids.add(str(t["id"]))
            if nonempty_ont > 0 and len(ont_ids) < 2 and genes_table.num_rows > 100:
                errors.append(
                    f"ontology_terms has only {len(ont_ids)} distinct SO id(s) "
                    f"across {nonempty_ont} annotated gene(s); expected biotype diversity"
                )

            ft_ids = {
                str(r.get("feature_type_id"))
                for r in rows
                if r.get("feature_type_id")
            }
            if not ft_ids:
                errors.append("genes.parquet has no feature_type_id values")
            elif any(not s.startswith("SO:") for s in ft_ids):
                bad = sorted(s for s in ft_ids if not s.startswith("SO:"))[:5]
                errors.append(f"non-SO feature_type_id values: {bad}")

    # filtering_terms.json catalog (Beacon facets; no gene CURIE dump)
    ft_path = root / "filtering_terms.json"
    if not ft_path.is_file():
        errors.append("missing filtering_terms.json")
    elif manifest.get("filteringTermsPath") != "filtering_terms.json":
        errors.append("manifest.filteringTermsPath missing or not filtering_terms.json")
    elif ft_path.is_file():
        with ft_path.open(encoding="utf-8") as fh:
            ft_doc = json.load(fh)
        ft_terms = ft_doc.get("filteringTerms") or []
        ft_resources = ft_doc.get("resources") or []
        if not ft_terms:
            errors.append("filtering_terms.json has empty filteringTerms")
        if not ft_resources:
            errors.append("filtering_terms.json has empty resources")
        for term in ft_terms:
            if not isinstance(term, dict):
                errors.append("filteringTerms entry is not an object")
                continue
            for req in ("type", "id", "scopes"):
                if req not in term:
                    errors.append(f"filteringTerm {term.get('id')!r} missing {req}")
                    break
            tid = str(term.get("id") or "")
            if tid.startswith(("HGNC:", "NCBIGene:", "ENSEMBL:", "Ensembl:")):
                errors.append(
                    f"filteringTerms must not enumerate gene CURIEs (found {tid})"
                )
        res_ids = {
            str(r.get("id") or "").lower()
            for r in ft_resources
            if isinstance(r, dict)
        }
        if "so" not in res_ids and any(
            isinstance(t, dict) and "genomicFeature" in (t.get("scopes") or [])
            for t in ft_terms
        ):
            errors.append("filtering_terms resources missing so")
        # When genes carry HGNC/NCBIGene xrefs, those namespaces must be declared
        if genes_path.is_file():
            import pyarrow.parquet as pq

            sample = pq.read_table(genes_path, columns=["xrefs"]).to_pylist()[:5000]
            has_hgnc = any(
                any(str(x).startswith("HGNC:") for x in (r.get("xrefs") or []))
                for r in sample
            )
            has_ncbi = any(
                any(str(x).startswith("NCBIGene:") for x in (r.get("xrefs") or []))
                for r in sample
            )
            if has_hgnc and "hgnc" not in res_ids:
                errors.append("filtering_terms resources missing hgnc (xrefs present)")
            if has_ncbi and "ncbigene" not in res_ids:
                errors.append(
                    "filtering_terms resources missing ncbigene (xrefs present)"
                )
        meta_ft = manifest.get("filteringTerms")
        if isinstance(meta_ft, dict) and "termCount" in meta_ft:
            if meta_ft.get("termCount") != len(ft_terms):
                errors.append(
                    f"manifest.filteringTerms.termCount={meta_ft.get('termCount')} "
                    f"!= filteringTerms length={len(ft_terms)}"
                )

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
