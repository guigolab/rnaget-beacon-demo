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

SERVER_DIR = SCRIPTS_DIR.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


# Expression percentile bands / profiles advertised at root (unit-free, precomputed).
# Quintiles of median (features) / detected_genes (biosamples); "none" = undetected.
_EXPRESSION_PERCENTILE_BANDS = (
    "none",
    "0-20",
    "20-40",
    "40-60",
    "60-80",
    "80-100",
)
_EXPRESSION_PROFILES = (
    "not-detected",
    "ubiquitous",
    "tissue-enriched",
    "low-specificity",
)
_DETECTED_BUCKETS = ("10%", "50%", "90%")
# Minimum biosamples before a matrix contributes band/profile terms.
_EXPRESSION_MIN_N = 10


def _append_expression_root_terms(
    package: Path,
    terms: Dict[str, Dict[str, Any]],
    needed_resources: Set[str],
) -> None:
    """Add categorical expression.* terms from per-matrix stats parquet."""
    import pyarrow.parquet as pq

    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        return
    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)

    saw_feature_band = False
    saw_feature_profile = False
    saw_detected = False
    saw_bio_band = False
    enriched_ids: Dict[str, Optional[str]] = {}

    for entry in manifest.get("matrices") or []:
        dirname = entry.get("dir")
        if not dirname:
            continue
        matrix_dir = package / "matrices" / dirname
        feat_stats = matrix_dir / "feature_expression_stats.parquet"
        bio_stats = matrix_dir / "biosample_expression_stats.parquet"
        bio_path = matrix_dir / "biosamples.parquet"

        n_bio = 0
        if bio_path.is_file():
            n_bio = int(pq.ParquetFile(bio_path).metadata.num_rows or 0)

        if feat_stats.is_file() and n_bio >= _EXPRESSION_MIN_N:
            names = set(pq.read_schema(feat_stats).names)
            want = [
                c
                for c in ("band", "profile", "enriched_in", "detected_fraction")
                if c in names
            ]
            if want:
                for batch in pq.ParquetFile(feat_stats).iter_batches(
                    columns=want, batch_size=8192
                ):
                    rows = batch.to_pylist()
                    for row in rows:
                        band = row.get("band")
                        if band:
                            saw_feature_band = True
                        profile = row.get("profile")
                        if profile:
                            saw_feature_profile = True
                        enriched = row.get("enriched_in")
                        if enriched and str(enriched).strip():
                            enriched_ids.setdefault(str(enriched), None)
                        frac = row.get("detected_fraction")
                        if frac is not None:
                            saw_detected = True

        if bio_stats.is_file() and n_bio >= _EXPRESSION_MIN_N:
            names = set(pq.read_schema(bio_stats).names)
            if "detected_genes_band" in names:
                for batch in pq.ParquetFile(bio_stats).iter_batches(
                    columns=["detected_genes_band"], batch_size=8192
                ):
                    for val in batch.column(0).to_pylist():
                        if val:
                            saw_bio_band = True
                            break
                    if saw_bio_band:
                        break

        # Resolve enrichment labels from biosample ontology when possible.
        if enriched_ids and bio_path.is_file():
            bio_names = set(pq.read_schema(bio_path).names)
            if "ontology_id" in bio_names and "ontology_label" in bio_names:
                for batch in pq.ParquetFile(bio_path).iter_batches(
                    columns=["ontology_id", "ontology_label"], batch_size=8192
                ):
                    for row in batch.to_pylist():
                        oid = row.get("ontology_id")
                        if oid is None:
                            continue
                        oid_s = str(oid)
                        if oid_s in enriched_ids and not enriched_ids[oid_s]:
                            label = row.get("ontology_label")
                            enriched_ids[oid_s] = (
                                str(label) if label else None
                            )

    if saw_feature_band:
        for band in _EXPRESSION_PERCENTILE_BANDS:
            if band == "none":
                label = "Expression percentile: none (not detected)"
            else:
                label = f"Expression percentile: {band}"
            _add_term(
                terms,
                type_="custom",
                id_=f"expression.percentile.{band}",
                label=label,
                scopes=["genomicFeature"],
            )
    if saw_feature_profile:
        for profile in _EXPRESSION_PROFILES:
            _add_term(
                terms,
                type_="custom",
                id_=f"expression.profile:{profile}",
                label=f"Expression profile: {profile}",
                scopes=["genomicFeature"],
            )
    if saw_detected:
        for bucket in _DETECTED_BUCKETS:
            _add_term(
                terms,
                type_="custom",
                id_=f"expression.detected:>={bucket}",
                label=f"Detected in at least {bucket} of biosamples",
                scopes=["genomicFeature"],
            )
    for oid, label in sorted(enriched_ids.items()):
        pref = _prefix_of(oid)
        if pref:
            resource_key = pref.lower()
            if resource_key in RESOURCE_DEFS:
                needed_resources.add(resource_key)
        _add_term(
            terms,
            type_="custom",
            id_=f"expression.enrichedIn:{oid}",
            label=f"Enriched in {label or oid}",
            scopes=["genomicFeature"],
        )
    if saw_bio_band:
        for band in _EXPRESSION_PERCENTILE_BANDS:
            if band == "none":
                label = "Detected-genes percentile: none (none detected)"
            else:
                label = f"Detected-genes percentile: {band}"
            _add_term(
                terms,
                type_="custom",
                id_=f"expression.detectedGenesPercentile.{band}",
                label=label,
                scopes=["biosample"],
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
    if pref in ("UBERON", "EFO", "OBI", "MONDO", "HP", "GO", "NCIT", "SO"):
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
    if resource is None:
        return
    res = str(resource).strip()
    if not res or res.lower() == "gencode":
        return
    _add_term(
        terms,
        type_="custom",
        id_=f"resource:{res}",
        label=f"Annotation resource {res}",
        scopes=scopes,
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
        bio_schema = pq.read_schema(bio_path).names
        want_bio = [
            c
            for c in (
                "ontology_id",
                "ontology_label",
                "ontology_source",
                "biosample_status_id",
                "biosample_status_label",
                "sample_origin_type_id",
                "sample_origin_type_label",
                "sample_processing_id",
                "sample_processing_label",
                "phenotype_ids",
                "phenotypic_features",
                "measurement_assay_ids",
                "sex",
                "age_bracket",
                "condition",
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
                if oid_missing:
                    continue
                oid_s = str(oid)
                _register_ontology_term(
                    terms,
                    needed_resources,
                    oid=oid_s,
                    label=str(olabel) if olabel else None,
                    scopes=["biosample"],
                )
                st_id = row.get("biosample_status_id")
                st_label = row.get("biosample_status_label")
                if st_id is not None and not (
                    isinstance(st_id, float) and st_id != st_id
                ):
                    _register_ontology_term(
                        terms,
                        needed_resources,
                        oid=str(st_id),
                        label=str(st_label) if st_label else None,
                        scopes=["biosample"],
                    )
                for col, label_col in (
                    ("sample_origin_type_id", "sample_origin_type_label"),
                    ("sample_processing_id", "sample_processing_label"),
                ):
                    tid = row.get(col)
                    tlabel = row.get(label_col)
                    if tid is None or (isinstance(tid, float) and tid != tid):
                        continue
                    _register_ontology_term(
                        terms,
                        needed_resources,
                        oid=str(tid),
                        label=str(tlabel) if tlabel else None,
                        scopes=["biosample"],
                    )
                for pid in row.get("phenotype_ids") or []:
                    if pid:
                        _register_ontology_term(
                            terms,
                            needed_resources,
                            oid=str(pid),
                            label=None,
                            scopes=["biosample"],
                        )
                for feat in row.get("phenotypic_features") or []:
                    if not isinstance(feat, dict):
                        continue
                    for key in ("featureType", "severity"):
                        block = feat.get(key) or {}
                        if isinstance(block, dict) and block.get("id"):
                            _register_ontology_term(
                                terms,
                                needed_resources,
                                oid=str(block["id"]),
                                label=str(block.get("label"))
                                if block.get("label")
                                else None,
                                scopes=["biosample"],
                            )
                for mid in row.get("measurement_assay_ids") or []:
                    if mid:
                        _register_ontology_term(
                            terms,
                            needed_resources,
                            oid=str(mid),
                            label=None,
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
                    pref = _prefix_of(tid_s)
                    if pref in ("SO", "GO"):
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
                        _add_term(
                            terms,
                            type_="SO",
                            id_=str(ft_id),
                            label=str(row["feature_type_label"])
                            if row.get("feature_type_label")
                            else None,
                            scopes=["genomicFeature"],
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
    _append_matrix_scope_terms(terms, needed_resources)
    _append_live_matrix_catalog_terms(package, terms, needed_resources)

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
