#!/usr/bin/env python3
"""Build Beacon filtering_terms.json from an enriched Parquet data package."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

GENE_CURIE_RE = re.compile(r"^(HGNC|NCBIGene|ENSEMBL):", re.IGNORECASE)

SERVER_DIR = SCRIPTS_DIR.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


def _emit_expression_support_terms(
    support,
    terms: Dict[str, Dict[str, Any]],
    needed_resources: Set[str],
    *,
    matrix_scoped: bool = False,
) -> None:
    """Emit expression.percentile (custom) from support.

    Catalog ``type`` is custom: median percentile is not a genomicFeature schema
    field (Beacon filteringTermsSchema). Request wire stays alphanumeric
    ``id`` + operator + value. Biosample presets are not catalogued.
    """
    from beacon.expression_filter_maps import (
        EXPRESSION_PERCENTILE_ID,
        PERCENTILE_CATALOG_VALUES,
    )
    from beacon.filter_display import expression_percentile_label

    values = support.percentile_catalog_values()
    if values:
        # Prefer full demo chip set when all thresholds are present.
        catalog_values = (
            list(PERCENTILE_CATALOG_VALUES)
            if set(values) >= set(PERCENTILE_CATALOG_VALUES)
            else values
        )
        _add_term(
            terms,
            type_="custom",
            id_=EXPRESSION_PERCENTILE_ID,
            label=expression_percentile_label(matrix_scoped=matrix_scoped),
            scopes=["genomicFeature"],
            values=catalog_values,
        )


def _append_expression_root_terms(
    package: Path,
    terms: Dict[str, Dict[str, Any]],
    needed_resources: Set[str],
) -> None:
    """Add expression.percentile from per-matrix stats parquet."""
    from beacon.expression_catalog_support import (
        merge_expression_support,
        scan_matrix_expression_support,
    )

    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        return
    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)

    parts = []
    for entry in manifest.get("matrices") or []:
        dirname = entry.get("dir")
        if not dirname:
            continue
        parts.append(scan_matrix_expression_support(package / "matrices" / dirname))

    support = merge_expression_support(parts)
    _emit_expression_support_terms(
        support,
        terms,
        needed_resources,
        matrix_scoped=False,
    )


def _append_biotype_family_terms(
    terms: Dict[str, Dict[str, Any]],
) -> None:
    """Emit custom feature.biotypeFamily with present family keys as values.

    Catalog ``type`` is custom: biotype family is a rollup, not a genomicFeature
    schema field (schema uses ontology ``featureType``). Request wire stays
    alphanumeric ``id`` + ``=`` + value.
    """
    from beacon.biotype_families import families_present_in
    from beacon.filters import FEATURE_BIOTYPE_FAMILY_ID
    from beacon.filter_display import biotype_family_catalog_label

    so_ids = [
        str(t.get("id"))
        for t in terms.values()
        if str(t.get("type") or "").upper() == "SO"
        or str(t.get("id") or "").upper().startswith("SO:")
    ]
    values = sorted(families_present_in(so_ids))
    if not values:
        return
    _add_term(
        terms,
        type_="custom",
        id_=FEATURE_BIOTYPE_FAMILY_ID,
        label=biotype_family_catalog_label(),
        scopes=["genomicFeature"],
        values=values,
    )


def _pretty_so_term_labels(terms: Dict[str, Dict[str, Any]]) -> None:
    from beacon.filter_display import so_display_label

    for term in terms.values():
        tid = str(term.get("id") or "")
        if str(term.get("type") or "").upper() != "SO" and not tid.upper().startswith(
            "SO:"
        ):
            continue
        term["label"] = so_display_label(term.get("label"), fallback_id=tid)


def _append_tissue_explore_terms(
    package: Path, terms: Dict[str, Dict[str, Any]]
) -> None:
    """Advertise tissueTop / tissuePresent customs from tissue_feature_summary."""
    try:
        from beacon.tissue_explore_catalog import tissue_explore_filtering_terms_for_package
    except ImportError:
        return
    for term in tissue_explore_filtering_terms_for_package(package):
        tid = str(term.get("id") or "")
        if not tid:
            continue
        _add_term(
            terms,
            type_=str(term.get("type") or "custom"),
            id_=tid,
            label=term.get("label"),
            scopes=list(term.get("scopes") or ["genomicFeature"]),
        )


def _append_matrix_scope_terms(
    terms: Dict[str, Dict[str, Any]], needed_resources: Set[str]
) -> None:
    try:
        from beacon.matrix_catalog_seed import load_matrix_seed_terms
    except ImportError:
        return
    for term in load_matrix_seed_terms():
        type_ = str(term.get("type") or "unknown")
        id_ = str(term.get("id") or "")
        if not id_:
            continue
        if type_ == "SO":
            needed_resources.add("so")
        if type_ == "OBI":
            needed_resources.add("obi")
        _add_term(
            terms,
            type_=type_,
            id_=id_,
            label=term.get("label"),
            scopes=list(term.get("scopes") or ["matrix"]),
            values=term.get("values"),
        )


def _append_live_matrix_catalog_terms(
    package: Path,
    terms: Dict[str, Dict[str, Any]],
    needed_resources: Set[str],
) -> None:
    """Merge facets from matrices.json (unit, annotation, assembly, …)."""
    matrices_path = package / "matrices.json"
    if not matrices_path.is_file():
        return
    try:
        from beacon.matrix_catalog import build_matrix_filtering_terms
    except ImportError:
        return
    with matrices_path.open(encoding="utf-8") as fh:
        matrices = json.load(fh)
    if not isinstance(matrices, list):
        return
    m_terms, m_resources = build_matrix_filtering_terms(matrices)
    for term in m_terms:
        type_ = str(term.get("type") or "unknown")
        id_ = str(term.get("id") or "")
        if not id_:
            continue
        if type_ == "SO":
            needed_resources.add("so")
        if type_ == "OBI":
            needed_resources.add("obi")
        _add_term(
            terms,
            type_=type_,
            id_=id_,
            label=term.get("label"),
            scopes=list(term.get("scopes") or ["matrix"]),
            values=term.get("values"),
        )
    for resource in m_resources:
        rid = str(resource.get("id") or "").lower()
        if rid:
            needed_resources.add(rid)


RESOURCE_DEFS: Dict[str, Dict[str, str]] = {
    "so": {
        "id": "so",
        "name": "Sequence Ontology",
        "nameSpacePrefix": "SO",
        "iriPrefix": "http://purl.obolibrary.org/obo/SO_",
        "url": "http://purl.obolibrary.org/obo/so.obo",
    },
    "uberon": {
        "id": "uberon",
        "name": "Uberon",
        "nameSpacePrefix": "UBERON",
        "iriPrefix": "http://purl.obolibrary.org/obo/UBERON_",
        "url": "http://purl.obolibrary.org/obo/uberon.owl",
    },
    "efo": {
        "id": "efo",
        "name": "Experimental Factor Ontology",
        "nameSpacePrefix": "EFO",
        "iriPrefix": "http://www.ebi.ac.uk/efo/EFO_",
        "url": "https://www.ebi.ac.uk/efo/efo.owl",
    },
    "hgnc": {
        "id": "hgnc",
        "name": "HUGO Gene Nomenclature Committee",
        "nameSpacePrefix": "HGNC",
        "iriPrefix": "https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/",
        "url": "https://www.genenames.org",
    },
    "ncbigene": {
        "id": "ncbigene",
        "name": "NCBI Gene",
        "nameSpacePrefix": "NCBIGene",
        "iriPrefix": "https://www.ncbi.nlm.nih.gov/gene/",
        "url": "https://www.ncbi.nlm.nih.gov/gene",
    },
    "ensembl": {
        "id": "ensembl",
        "name": "Ensembl",
        "nameSpacePrefix": "ENSEMBL",
        "iriPrefix": "https://www.ensembl.org/id/",
        "url": "https://www.ensembl.org",
    },
    "obi": {
        "id": "obi",
        "name": "Ontology for Biomedical Investigations",
        "nameSpacePrefix": "OBI",
        "iriPrefix": "http://purl.obolibrary.org/obo/OBI_",
        "url": "http://purl.obolibrary.org/obo/obi.owl",
    },
    "mondo": {
        "id": "mondo",
        "name": "Mondo Disease Ontology",
        "nameSpacePrefix": "MONDO",
        "iriPrefix": "http://purl.obolibrary.org/obo/MONDO_",
        "url": "http://purl.obolibrary.org/obo/mondo.owl",
    },
    "hp": {
        "id": "hp",
        "name": "Human Phenotype Ontology",
        "nameSpacePrefix": "HP",
        "iriPrefix": "http://purl.obolibrary.org/obo/HP_",
        "url": "http://purl.obolibrary.org/obo/hp.owl",
    },
    "go": {
        "id": "go",
        "name": "Gene Ontology",
        "nameSpacePrefix": "GO",
        "iriPrefix": "http://purl.obolibrary.org/obo/GO_",
        "url": "http://purl.obolibrary.org/obo/go.owl",
    },
    "ncit": {
        "id": "ncit",
        "name": "NCI Thesaurus",
        "nameSpacePrefix": "NCIT",
        "iriPrefix": "http://purl.obolibrary.org/obo/NCIT_",
        "url": "https://evs.nci.nih.gov/ftp1/NCI_Thesaurus",
    },
    "uo": {
        "id": "uo",
        "name": "Units of Measurement Ontology",
        "nameSpacePrefix": "UO",
        "iriPrefix": "http://purl.obolibrary.org/obo/UO_",
        "url": "http://purl.obolibrary.org/obo/uo.owl",
    },
    "symbol": {
        "id": "symbol",
        "name": "Gene symbol",
        "nameSpacePrefix": "symbol",
        "iriPrefix": "https://www.genenames.org/tools/search/#!/?query=",
        "url": "https://www.genenames.org",
    },
}


def _register_ontology_term(
    terms: Dict[str, Dict[str, Any]],
    needed_resources: Set[str],
    *,
    oid: str,
    label: Optional[str],
    scopes: List[str],
) -> None:
    pref = _prefix_of(oid)
    resource_key = pref.lower()
    if pref == "NCBIGENE":
        resource_key = "ncbigene"
    # Biosample catalogs only advertise UBERON/EFO; other prefixes here are for
    # genomicFeature / matrix (SO, GO, OBI, …).
    if pref in ("UBERON", "EFO", "OBI", "MONDO", "HP", "GO", "NCIT", "SO"):
        if "biosample" in scopes and pref not in ("UBERON", "EFO"):
            return
        if resource_key in RESOURCE_DEFS:
            needed_resources.add(resource_key)
        _add_term(
            terms,
            type_=pref if pref != "NCBIGENE" else "custom",
            id_=oid,
            label=label,
            scopes=scopes,
        )


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Build filtering_terms.json for a Parquet data package"
    )
    p.add_argument("--package", type=Path, required=True)
    return p


def _prefix_of(curie: str) -> str:
    if ":" not in curie:
        return ""
    return curie.split(":", 1)[0].upper()


def _add_term(
    terms: Dict[str, Dict[str, Any]],
    *,
    type_: str,
    id_: str,
    label: Optional[str],
    scopes: List[str],
    values: Optional[List[str]] = None,
) -> None:
    if GENE_CURIE_RE.match(id_):
        raise SystemExit(
            f"Refusing to catalog gene CURIE as filteringTerm: {id_!r}"
        )
    existing = terms.get(id_)
    if existing is None:
        entry: Dict[str, Any] = {
            "type": type_,
            "id": id_,
            "scopes": list(scopes),
        }
        if label:
            entry["label"] = label
        if values:
            entry["values"] = list(values)
        terms[id_] = entry
        return
    # Merge scopes / label / values
    scope_set = list(dict.fromkeys((existing.get("scopes") or []) + scopes))
    existing["scopes"] = scope_set
    if label and not existing.get("label"):
        existing["label"] = label
    if values:
        merged = list(dict.fromkeys((existing.get("values") or []) + values))
        existing["values"] = merged


def _emit_resource_term(
    terms: Dict[str, Dict[str, Any]],
    resource: Any,
    scopes: List[str],
) -> None:
    """Emit alphanumeric feature.resource with GenCode + NCBI Gene values.

    Both display values are catalogued whenever any annotation resource is seen;
    matching equals the stored ``resource`` column (gencode|ncbigene).
    """
    if resource is None:
        return
    res = str(resource).strip()
    if not res:
        return
    from beacon.filters import FEATURE_RESOURCE_CATALOG_VALUES, FEATURE_RESOURCE_ID

    _add_term(
        terms,
        type_="alphanumeric",
        id_=FEATURE_RESOURCE_ID,
        label="Annotation resource",
        scopes=scopes,
        values=list(FEATURE_RESOURCE_CATALOG_VALUES),
    )


def build_catalog(package: Path) -> Dict[str, Any]:
    import pyarrow.parquet as pq

    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Missing {manifest_path}")
    with manifest_path.open(encoding="utf-8") as fh:
        manifest: Dict[str, Any] = json.load(fh)

    terms: Dict[str, Dict[str, Any]] = {}
    needed_resources: Set[str] = set()
    xref_prefixes: Set[str] = set()

    # --- Biosamples (UBERON/EFO tissues only; no status/OBI/phenotype ontologies) ---
    from beacon.filter_display import is_biosample_catalog_ontology_id

    for entry in manifest.get("matrices") or []:
        dirname = entry.get("dir")
        if not dirname:
            continue
        bio_path = package / "matrices" / dirname / "biosamples.parquet"
        if not bio_path.is_file():
            continue
        bio_schema = pq.read_schema(bio_path).names
        want_bio = [
            c
            for c in (
                "ontology_id",
                "ontology_label",
            )
            if c in bio_schema
        ]
        if not want_bio:
            continue
        for batch in pq.ParquetFile(bio_path).iter_batches(
            columns=want_bio, batch_size=8192
        ):
            for row in batch.to_pylist():
                oid = row.get("ontology_id")
                olabel = row.get("ontology_label")
                oid_missing = oid is None or (isinstance(oid, float) and oid != oid)
                if oid_missing:
                    continue
                oid_s = str(oid)
                if not is_biosample_catalog_ontology_id(oid_s):
                    continue
                _register_ontology_term(
                    terms,
                    needed_resources,
                    oid=oid_s,
                    label=str(olabel) if olabel else None,
                    scopes=["biosample"],
                )

    # --- Genes / features ---
    genes_path = package / "genes.parquet"
    if genes_path.is_file():
        gene_cols = set(pq.read_schema(genes_path).names)
        want_gene = [
            c
            for c in (
                "feature_type_id",
                "feature_type_label",
                "ontology_terms",
                "resource",
                "annotation_source",
                "xrefs",
            )
            if c in gene_cols
        ]
        pf = pq.ParquetFile(genes_path)
        for batch in pf.iter_batches(
            columns=want_gene or None, batch_size=8192
        ):
            for g in batch.to_pylist():
                ft_id = g.get("feature_type_id")
                ft_label = g.get("feature_type_label")
                if ft_id:
                    ft_s = str(ft_id)
                    if _prefix_of(ft_s) == "SO":
                        needed_resources.add("so")
                        from beacon.filter_display import so_display_label

                        _add_term(
                            terms,
                            type_="SO",
                            id_=ft_s,
                            label=so_display_label(
                                str(ft_label) if ft_label else None,
                                fallback_id=ft_s,
                            ),
                            # Dual-scope: feature lens + matrices listing (featureTypes / biotypes).
                            scopes=["genomicFeature", "matrix"],
                        )
                for term in g.get("ontology_terms") or []:
                    if not isinstance(term, dict):
                        continue
                    tid = term.get("id")
                    if not tid:
                        continue
                    tid_s = str(tid)
                    pref = _prefix_of(tid_s)
                    if pref == "SO":
                        _register_ontology_term(
                            terms,
                            needed_resources,
                            oid=tid_s,
                            label=str(term["label"]) if term.get("label") else None,
                            scopes=["genomicFeature", "matrix"],
                        )
                    elif pref == "GO":
                        _register_ontology_term(
                            terms,
                            needed_resources,
                            oid=tid_s,
                            label=str(term["label"]) if term.get("label") else None,
                            scopes=["genomicFeature"],
                        )
                resource = g.get("resource")
                _emit_resource_term(terms, resource, scopes=["genomicFeature"])
                src = (g.get("annotation_source") or "").lower()
                if src in ("gencode", "ensembl"):
                    needed_resources.add("ensembl")
                    needed_resources.add("hgnc")
                if src in ("ncbigene", "ncbi", "refseq"):
                    needed_resources.add("ncbigene")
                    needed_resources.add("hgnc")
                for x in g.get("xrefs") or []:
                    pref = _prefix_of(str(x))
                    if pref:
                        xref_prefixes.add(pref.upper())
    else:
        # Fallback: scan per-matrix features (facet columns only, batched)
        for entry in manifest.get("matrices") or []:
            dirname = entry.get("dir")
            if not dirname:
                continue
            feat_path = package / "matrices" / dirname / "features.parquet"
            if not feat_path.is_file():
                continue
            feat_names = set(pq.read_schema(feat_path).names)
            want_feat = [
                c
                for c in ("feature_type_id", "feature_type_label", "resource")
                if c in feat_names
            ]
            if not want_feat:
                continue
            for batch in pq.ParquetFile(feat_path).iter_batches(
                columns=want_feat, batch_size=8192
            ):
                for row in batch.to_pylist():
                    ft_id = row.get("feature_type_id")
                    if ft_id and _prefix_of(str(ft_id)) == "SO":
                        needed_resources.add("so")
                        from beacon.filter_display import so_display_label

                        ft_s = str(ft_id)
                        raw_label = (
                            str(row["feature_type_label"])
                            if row.get("feature_type_label")
                            else None
                        )
                        _add_term(
                            terms,
                            type_="SO",
                            id_=ft_s,
                            label=so_display_label(raw_label, fallback_id=ft_s),
                            scopes=["genomicFeature", "matrix"],
                        )
                    _emit_resource_term(
                        terms, row.get("resource"), scopes=["genomicFeature"]
                    )

    for pref in xref_prefixes:
        if pref == "HGNC":
            needed_resources.add("hgnc")
        elif pref == "NCBIGENE":
            needed_resources.add("ncbigene")
        elif pref in ("ENSEMBL", "ENSG"):
            needed_resources.add("ensembl")

    # Symbol is a lookup namespace (custom filter id ``symbol:TP53``); no term dump.
    if genes_path.is_file() or any(
        (package / "matrices" / (e.get("dir") or "") / "features.parquet").is_file()
        for e in (manifest.get("matrices") or [])
    ):
        needed_resources.add("symbol")

    _append_expression_root_terms(package, terms, needed_resources)
    _append_biotype_family_terms(terms)
    _append_tissue_explore_terms(package, terms)
    _append_matrix_scope_terms(terms, needed_resources)
    _append_live_matrix_catalog_terms(package, terms, needed_resources)
    _pretty_so_term_labels(terms)

    if any("genomicFeature" in (t.get("scopes") or []) for t in terms.values()):
        needed_resources.add("so")

    resources = [
        RESOURCE_DEFS[key]
        for key in (
            "so",
            "go",
            "obi",
            "uberon",
            "efo",
            "mondo",
            "hp",
            "ncit",
            "uo",
            "hgnc",
            "ncbigene",
            "ensembl",
            "symbol",
        )
        if key in needed_resources and key in RESOURCE_DEFS
    ]

    filtering_terms = sorted(terms.values(), key=lambda t: (t["id"], t["type"]))
    for t in filtering_terms:
        if GENE_CURIE_RE.match(t["id"]):
            raise SystemExit(f"Illegal gene CURIE in filteringTerms: {t['id']}")

    by_scope: Dict[str, List[str]] = {
        "biosample": [],
        "genomicFeature": [],
        "matrix": [],
    }
    for t in filtering_terms:
        for scope in t.get("scopes") or []:
            if scope in by_scope:
                by_scope[scope].append(t["id"])

    return {
        "schemaVersion": 1,
        "resources": resources,
        "filteringTerms": filtering_terms,
        "byScope": by_scope,
    }


def write_catalog(package: Path, catalog: Dict[str, Any]) -> None:
    out_path = package / "filtering_terms.json"
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(catalog, fh, indent=2)
        fh.write("\n")

    manifest_path = package / "manifest.json"
    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)
    manifest["filteringTermsPath"] = "filtering_terms.json"
    manifest["filteringTerms"] = {
        "termCount": len(catalog.get("filteringTerms") or []),
        "resourceCount": len(catalog.get("resources") or []),
    }
    with manifest_path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(
        f"Wrote {out_path.name}: terms={manifest['filteringTerms']['termCount']} "
        f"resources={manifest['filteringTerms']['resourceCount']}"
    )


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    package = args.package
    if not package.is_dir():
        print(f"Package not found: {package}", file=sys.stderr)
        return 1
    catalog = build_catalog(package)
    write_catalog(package, catalog)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
