#!/usr/bin/env python3
"""Build Beacon filtering_terms.json from an enriched Parquet data package."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

GENE_CURIE_RE = re.compile(r"^(HGNC|NCBIGene|ENSEMBL):", re.IGNORECASE)

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
}


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


def build_catalog(package: Path) -> Dict[str, Any]:
    import pyarrow.parquet as pq

    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Missing {manifest_path}")
    with manifest_path.open(encoding="utf-8") as fh:
        manifest: Dict[str, Any] = json.load(fh)

    terms: Dict[str, Dict[str, Any]] = {}
    needed_resources: Set[str] = set()
    has_geo = False
    sex_values: Set[str] = set()
    age_values: Set[str] = set()
    condition_values: Set[str] = set()
    xref_prefixes: Set[str] = set()

    # --- Biosamples ---
    for entry in manifest.get("matrices") or []:
        dirname = entry.get("dir")
        if not dirname:
            continue
        bio_path = package / "matrices" / dirname / "biosamples.parquet"
        if not bio_path.is_file():
            continue
        want_bio = [
            c
            for c in (
                "ontology_id",
                "ontology_label",
                "ontology_source",
                "sex",
                "age_bracket",
                "condition",
            )
            if c in pq.read_schema(bio_path).names
        ]
        table = pq.read_table(bio_path, columns=want_bio or None)
        rows = table.to_pylist()
        del table
        for row in rows:
            oid = row.get("ontology_id")
            olabel = row.get("ontology_label")
            osource = row.get("ontology_source")
            sex = row.get("sex")
            if sex is not None and str(sex).strip():
                sex_values.add(str(sex).strip())
            age = row.get("age_bracket")
            if age is not None and str(age).strip():
                age_values.add(str(age).strip())
            cond = row.get("condition")
            if cond is not None and str(cond).strip():
                condition_values.add(str(cond).strip())
            oid_missing = oid is None or (isinstance(oid, float) and oid != oid)
            # Keep GEO:sample facet only while some samples still lack detail.
            if (
                oid_missing
                and osource
                and str(osource).upper() == "GEO"
            ):
                has_geo = True
            if oid_missing:
                continue
            oid_s = str(oid)
            pref = _prefix_of(oid_s)
            if pref in ("UBERON", "EFO"):
                needed_resources.add(pref.lower())
                _add_term(
                    terms,
                    type_=pref,
                    id_=oid_s,
                    label=str(olabel) if olabel else None,
                    scopes=["biosample"],
                )
        del rows

    if has_geo:
        _add_term(
            terms,
            type_="custom",
            id_="GEO:sample",
            label="GEO sample",
            scopes=["biosample"],
        )
    # Advertise sex field when any biosample matrix exists; values optional.
    _add_term(
        terms,
        type_="alphanumeric",
        id_="sex",
        label="Sex",
        scopes=["biosample"],
        values=sorted(sex_values) if sex_values else None,
    )
    if age_values:
        _add_term(
            terms,
            type_="alphanumeric",
            id_="age_bracket",
            label="Age bracket",
            scopes=["biosample"],
            values=sorted(age_values),
        )
    if condition_values:
        _add_term(
            terms,
            type_="alphanumeric",
            id_="condition",
            label="Condition / treatment",
            scopes=["biosample"],
            values=sorted(condition_values),
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
        genes = pq.read_table(genes_path, columns=want_gene or None).to_pylist()
        for g in genes:
            ft_id = g.get("feature_type_id")
            ft_label = g.get("feature_type_label")
            if ft_id:
                ft_s = str(ft_id)
                if _prefix_of(ft_s) == "SO":
                    needed_resources.add("so")
                    _add_term(
                        terms,
                        type_="SO",
                        id_=ft_s,
                        label=str(ft_label) if ft_label else None,
                        scopes=["genomicFeature"],
                    )
            for term in g.get("ontology_terms") or []:
                if not isinstance(term, dict):
                    continue
                tid = term.get("id")
                if not tid:
                    continue
                tid_s = str(tid)
                if _prefix_of(tid_s) == "SO":
                    needed_resources.add("so")
                    _add_term(
                        terms,
                        type_="SO",
                        id_=tid_s,
                        label=str(term["label"]) if term.get("label") else None,
                        scopes=["genomicFeature"],
                    )
            resource = g.get("resource")
            if resource:
                rid = f"resource:{resource}"
                _add_term(
                    terms,
                    type_="custom",
                    id_=rid,
                    label=f"Annotation resource {resource}",
                    scopes=["genomicFeature"],
                )
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
        del genes
    else:
        # Fallback: scan per-matrix features
        for entry in manifest.get("matrices") or []:
            dirname = entry.get("dir")
            if not dirname:
                continue
            feat_path = package / "matrices" / dirname / "features.parquet"
            if not feat_path.is_file():
                continue
            for row in pq.read_table(feat_path).to_pylist():
                ft_id = row.get("feature_type_id")
                if ft_id and _prefix_of(str(ft_id)) == "SO":
                    needed_resources.add("so")
                    _add_term(
                        terms,
                        type_="SO",
                        id_=str(ft_id),
                        label=str(row["feature_type_label"])
                        if row.get("feature_type_label")
                        else None,
                        scopes=["genomicFeature"],
                    )
                resource = row.get("resource")
                if resource:
                    _add_term(
                        terms,
                        type_="custom",
                        id_=f"resource:{resource}",
                        label=f"Annotation resource {resource}",
                        scopes=["genomicFeature"],
                    )

    for pref in xref_prefixes:
        if pref == "HGNC":
            needed_resources.add("hgnc")
        elif pref == "NCBIGENE":
            needed_resources.add("ncbigene")
        elif pref in ("ENSEMBL", "ENSG"):
            needed_resources.add("ensembl")

    _add_term(
        terms,
        type_="alphanumeric",
        id_="genomicFeature.symbol",
        label="Gene symbol",
        scopes=["genomicFeature"],
    )

    # Drop sex term if no biosamples at all and no values — keep if any bio matrix
    if not any(
        (package / "matrices" / (e.get("dir") or "") / "biosamples.parquet").is_file()
        for e in (manifest.get("matrices") or [])
    ):
        terms.pop("sex", None)

    if any("genomicFeature" in (t.get("scopes") or []) for t in terms.values()):
        needed_resources.add("so")

    resources = [
        RESOURCE_DEFS[key]
        for key in ("so", "uberon", "efo", "hgnc", "ncbigene", "ensembl")
        if key in needed_resources and key in RESOURCE_DEFS
    ]

    filtering_terms = sorted(terms.values(), key=lambda t: (t["id"], t["type"]))
    for t in filtering_terms:
        if GENE_CURIE_RE.match(t["id"]):
            raise SystemExit(f"Illegal gene CURIE in filteringTerms: {t['id']}")

    by_scope: Dict[str, List[str]] = {"biosample": [], "genomicFeature": []}
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
