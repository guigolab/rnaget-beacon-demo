#!/usr/bin/env python3
"""Post-export checks for a Parquet data package (manifest, parts, matrix schema)."""

from __future__ import annotations

import argparse
import json
import re
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
            ann = doc.get("annotation") or {}
            if not ann.get("file"):
                errors.append(f"{mid}: annotation.file missing")
            elif not re.fullmatch(r"[0-9a-fA-F]{32}", str(ann.get("md5Checksum") or "")):
                errors.append(
                    f"{mid}: annotation.md5Checksum missing or not 32-hex "
                    "(run hydrate_genes after export)"
                )
            evr = doc.get("expressionValueRange")
            if not isinstance(evr, dict) or "min" not in evr or "max" not in evr:
                errors.append(f"{mid}: matrices.json missing expressionValueRange.min/max")

            # features.parquet genomic coords (after hydrate)
            feat_path = matrix_dir / "features.parquet"
            if feat_path.is_file():
                import pyarrow.parquet as pq

                feat = pq.read_table(feat_path)
                feat_cols = set(feat.column_names)
                for col in ("chrom", "start", "end", "strand"):
                    if col not in feat_cols:
                        errors.append(f"{mid}: features.parquet missing {col}")
                        break
                else:
                    n = feat.num_rows
                    if n > 0:
                        import pyarrow.compute as pc

                        chrom_col = feat.column("chrom")
                        nulls = int(pc.sum(pc.is_null(chrom_col)).as_py() or 0)
                        # Also treat empty strings as unfilled.
                        try:
                            empties = int(
                                pc.sum(pc.equal(chrom_col, "")).as_py() or 0
                            )
                        except Exception:
                            empties = 0
                        filled = n - nulls - empties
                        if filled / n < 0.5:
                            errors.append(
                                f"{mid}: features.parquet chrom filled on "
                                f"{filled}/{n} rows (<50%; re-run hydrate_genes)"
                            )

            bio_path = matrix_dir / "biosamples.parquet"
            if bio_path.is_file():
                import pyarrow.parquet as pq
                import pyarrow.compute as pc

                bio_schema_names = set(pq.read_schema(bio_path).names)
                if "sample_origin_type_id" in bio_schema_names:
                    bio = pq.read_table(bio_path, columns=["sample_origin_type_id"])
                else:
                    bio = pq.read_table(bio_path, columns=["biosample_id"])
                bio_cols = set(bio.column_names)
                if "sample_origin_type_id" in bio_cols and bio.num_rows > 0:
                    origin_col = bio.column("sample_origin_type_id")
                    # Sample a few non-null values without materializing all rows as dicts.
                    non_null = pc.drop_null(origin_col)
                    sample_n = min(20, non_null.length())
                    sample = [
                        str(non_null[i].as_py())
                        for i in range(sample_n)
                        if non_null[i].as_py() is not None
                    ]
                    bad = [x for x in sample if not x.startswith("OBI:")]
                    if bad:
                        errors.append(
                            f"{mid}: sample_origin_type_id must be OBI:* "
                            f"(e.g. found {bad[0]!r})"
                        )
                    # Also ensure majority are non-null OBI when column exists.
                    nulls = int(pc.sum(pc.is_null(origin_col)).as_py() or 0)
                    if nulls / bio.num_rows > 0.5:
                        errors.append(
                            f"{mid}: sample_origin_type_id null on "
                            f"{nulls}/{bio.num_rows} rows"
                        )
                elif bio.num_rows > 0:
                    errors.append(
                        f"{mid}: biosamples.parquet missing sample_origin_type_id "
                        "(re-run export_parquet)"
                    )

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

    # Enriched biosample / matrix metadata (when columns exist)
    matrices_path = root / "matrices.json"
    if matrices_path.is_file():
        with matrices_path.open(encoding="utf-8") as fh:
            matrix_docs = json.load(fh)
        obi_labels = set()
        for doc in matrix_docs if isinstance(matrix_docs, list) else []:
            assay = doc.get("assayType") or {}
            if assay.get("id") == "OBI:0003090" and assay.get("label"):
                obi_labels.add(str(assay["label"]))
        if obi_labels and len(obi_labels) > 1:
            errors.append(
                f"inconsistent OBI:0003090 labels in matrices.json: {sorted(obi_labels)}"
            )

    for entry in manifest.get("matrices") or []:
        dirname = entry.get("dir")
        if not dirname:
            continue
        bio_path = root / "matrices" / dirname / "biosamples.parquet"
        if not bio_path.is_file():
            continue
        import pyarrow.parquet as pq

        bio_schema = set(pq.read_schema(bio_path).names)
        if "biosample_status_id" in bio_schema:
            sample_rows = pq.read_table(
                bio_path,
                columns=[
                    c
                    for c in (
                        "biosample_status_id",
                        "biosample_status_label",
                        "phenotype_ids",
                        "sample_processing_id",
                        "sample_processing_label",
                        "measurements",
                    )
                    if c in bio_schema
                ],
            ).to_pylist()
            for row in sample_rows:
                sid = row.get("biosample_status_id")
                slabel = row.get("biosample_status_label")
                if sid and not slabel:
                    errors.append("biosample row missing biosample_status_label")
                for pid in row.get("phenotype_ids") or []:
                    if str(pid).startswith("MONDO:") and not slabel:
                        pass
                proc = row.get("sample_processing_id")
                plabel = row.get("sample_processing_label")
                if proc and not plabel:
                    errors.append("biosample row missing sample_processing_label")
            mid = entry.get("matrix_id") or ""
            if mid == "ENCSR622FSM":
                enc = [
                    r
                    for r in sample_rows
                    if r.get("sample_processing_id") == "GO:0005829"
                ]
                if bio_schema >= {"sample_processing_id"} and not enc:
                    errors.append(
                        "ENCBS924XCI expected sample_processing GO:0005829 on ENCSR622FSM"
                    )
            if "GSE164073" in mid or mid == "GSE164073":
                infected = [
                    r
                    for r in sample_rows
                    if r.get("biosample_status_id") == "EFO:0009655"
                    and r.get("phenotype_ids")
                    and any(
                        str(p) == "MONDO:0100096"
                        for p in (r.get("phenotype_ids") or [])
                    )
                ]
                if "phenotype_ids" in bio_schema and not infected:
                    errors.append(
                        "GSE164073 expected MONDO:0100096 abnormal biosample(s)"
                    )
        mid_str = str(entry.get("matrix_id") or "")
        if "measurements" in bio_schema and mid_str.startswith("GTEx"):
            has_rin = any(
                r.get("measurements")
                for r in pq.read_table(bio_path, columns=["measurements"])
                .to_pylist()[:50]
            )
            if not has_rin:
                errors.append("GTEx biosamples expected NCIT:C63637 RIN measurements")

    if genes_path.is_file():
        import pyarrow.parquet as pq

        gsample = pq.read_table(genes_path, columns=["xrefs", "feature_id"]).to_pylist()[
            :2000
        ]
        ens_rows = [
            r
            for r in gsample
            if str(r.get("feature_id") or "").upper().startswith("ENSG")
        ]
        if ens_rows and not any(
            any(str(x).startswith("NCBIGene:") for x in (r.get("xrefs") or []))
            for r in ens_rows[:100]
        ):
            errors.append(
                "genes.parquet: expected NCBIGene xrefs on ENSG rows after enrich_gene_annotations"
            )

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

    # Package-root feature / biosample indexes (after build_feature_indexes)
    index_paths = {
        "featureOntologyPath": "feature_ontology.parquet",
        "featureIndexPath": "feature_index.parquet",
        "featureMatrixPath": "feature_matrix.parquet",
        "biosamplesPath": "biosamples.parquet",
        "biosampleMatrixPath": "biosample_matrix.parquet",
    }
    index_files_present = all(
        (root / name).is_file() for name in index_paths.values()
    )
    if index_files_present:
        import pyarrow.parquet as pq

        for key, name in index_paths.items():
            if manifest.get(key) != name:
                errors.append(f"manifest.{key} missing or not {name}")

        fo = pq.read_table(root / "feature_ontology.parquet")
        fi = pq.read_table(root / "feature_index.parquet")
        fm = pq.read_table(root / "feature_matrix.parquet")
        bg = pq.read_table(root / "biosamples.parquet")
        bm = pq.read_table(root / "biosample_matrix.parquet")

        for required in (
            "feature_id",
            "wrapper_id",
            "ontology_id",
            "role",
        ):
            if required not in fo.column_names:
                errors.append(f"feature_ontology.parquet missing {required}")
        for required in (
            "wrapper_id",
            "feature_id",
            "ontology_terms",
            "feature_type_id",
        ):
            if required not in fi.column_names:
                errors.append(f"feature_index.parquet missing {required}")
        for required in ("wrapper_id", "feature_id", "matrix_id"):
            if required not in fm.column_names:
                errors.append(f"feature_matrix.parquet missing {required}")
        if "biosample_id" not in bg.column_names:
            errors.append("biosamples.parquet missing biosample_id")
        for required in ("biosample_id", "matrix_id"):
            if required not in bm.column_names:
                errors.append(f"biosample_matrix.parquet missing {required}")

        feat_meta = manifest.get("features") or {}
        if isinstance(feat_meta, dict) and "numUnique" in feat_meta:
            if int(feat_meta["numUnique"]) != fi.num_rows:
                errors.append(
                    f"manifest.features.numUnique={feat_meta['numUnique']} "
                    f"!= feature_index rows={fi.num_rows}"
                )
        bio_meta = manifest.get("biosamples") or {}
        if isinstance(bio_meta, dict) and "numUnique" in bio_meta:
            if int(bio_meta["numUnique"]) != bg.num_rows:
                errors.append(
                    f"manifest.biosamples.numUnique={bio_meta['numUnique']} "
                    f"!= biosamples.parquet rows={bg.num_rows}"
                )

        if "ontology_id" in fo.column_names and fo.num_rows > 0:
            ont_ids = [
                str(x)
                for x in fo.column("ontology_id").to_pylist()
                if x is not None
            ]
            gene_curie = [
                x
                for x in ont_ids[:5000]
                if x.upper().startswith(("HGNC:", "NCBIGENE:", "ENSEMBL:"))
            ]
            if gene_curie:
                errors.append(
                    f"feature_ontology ontology_id must not contain gene CURIEs "
                    f"(found {gene_curie[0]})"
                )
            so_ids = {x for x in ont_ids if x.startswith("SO:")}
            if "role" in fo.column_names:
                roles = set(fo.column("role").to_pylist())
                if "feature_type" not in roles:
                    errors.append("feature_ontology has no role=feature_type rows")
            # At least as many ontology edges as distinct feature types on index
            if "feature_type_id" in fi.column_names:
                ft_distinct = len(
                    {
                        str(x)
                        for x in fi.column("feature_type_id").to_pylist()
                        if x
                    }
                )
                if fo.num_rows < ft_distinct:
                    errors.append(
                        f"feature_ontology rows={fo.num_rows} < "
                        f"distinct feature_type_id={ft_distinct}"
                    )
            if not so_ids and fi.num_rows > 0:
                errors.append("feature_ontology has no SO:* ontology_id values")

        if fi.num_rows > 0 and fm.num_rows > 0:
            index_fids = set(fi.column("feature_id").to_pylist())
            matrix_fids = set(fm.column("feature_id").to_pylist())
            missing = index_fids - matrix_fids
            if missing:
                sample = sorted(str(x) for x in missing)[:5]
                errors.append(
                    f"feature_matrix missing feature_id(s) from feature_index: "
                    f"{sample}"
                    + (
                        f" (+{len(missing) - 5} more)"
                        if len(missing) > 5
                        else ""
                    )
                )
    else:
        # Soft note only when any index path is declared but files incomplete
        declared = any(manifest.get(k) for k in index_paths)
        if declared:
            for name in index_paths.values():
                if not (root / name).is_file():
                    errors.append(
                        f"manifest declares feature/biosample indexes but "
                        f"missing {name}"
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
