#!/usr/bin/env python3
"""Crosswalk Ensembl/GeneID xrefs and attach GO slim terms to feature ontology."""

from __future__ import annotations

import argparse
import gzip
import io
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from export_enrichment import (  # noqa: E402
    ensure_gene_info_path,
    load_gene_info_index,
    _normalize_gene_info_xrefs,
)
from parsers.base import CACHE_DIR
from so_map import parse_so_obo

GENE2ENSEMBL_URL = "https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene2ensembl.gz"
GENE2GO_URL = "https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene2go.gz"
GO_SLIM_OBO_URL = (
    "https://current.geneontology.org/ontology/subsets/goslim_generic.obo"
)


def _open_text(path: Path):
    if str(path).endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def _unversion_ensg(feature_id: str) -> str:
    fid = str(feature_id).strip()
    if fid.upper().startswith("ENSG") and "." in fid:
        return fid.split(".", 1)[0]
    return fid


def ensure_download(
    url: str,
    dest: Path,
    *,
    skip_download: bool = False,
    timeout: int = 600,
) -> Path:
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    if skip_download:
        raise FileNotFoundError(f"Cache miss: {dest}")
    with requests.get(url, stream=True, timeout=timeout) as resp:
        resp.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".partial")
        with tmp.open("wb") as out:
            for chunk in resp.iter_content(chunk_size=256 * 1024):
                if chunk:
                    out.write(chunk)
        tmp.replace(dest)
    return dest


def load_ensembl_to_ncbi(
    path: Path, *, tax_id: str = "9606"
) -> Dict[str, str]:
    out: Dict[str, str] = {}
    with _open_text(path) as fh:
        header = fh.readline()
        if not header.startswith("#"):
            fh.seek(0)
        import csv

        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            if (row.get("tax_id") or "").strip() != tax_id:
                continue
            gid = (row.get("GeneID") or row.get("gene_id") or "").strip()
            ens = (row.get("Ensembl_gene_identifier") or "").strip()
            if not gid or not ens:
                continue
            key = _unversion_ensg(ens)
            out.setdefault(key, gid)
    return out


def load_gene_info_by_id(
    cache_dir: Path, *, skip_download: bool = False
) -> Dict[str, Dict[str, Any]]:
    path = ensure_gene_info_path(cache_dir, skip_download=skip_download)
    by_id: Dict[str, Dict[str, Any]] = {}
    import csv

    with _open_text(path) as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            gid = (row.get("GeneID") or "").strip()
            if not gid:
                continue
            symbol = (row.get("Symbol") or "").strip()
            xrefs = _normalize_gene_info_xrefs(row.get("dbXrefs") or "")
            ncbi = f"NCBIGene:{gid}"
            if ncbi not in xrefs:
                xrefs = [ncbi] + xrefs
            by_id[gid] = {"symbol": symbol, "xrefs": xrefs}
    return by_id


def load_goslim_ids(path: Path) -> Set[str]:
    names = parse_so_obo(path)  # works for GO ids in OBO format
    return set(names.keys())


def load_gene2go_slim(
    path: Path, *, slim_ids: Set[str], tax_id: str = "9606"
) -> Dict[str, Set[str]]:
    by_gene: Dict[str, Set[str]] = {}
    import csv

    with _open_text(path) as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            if (row.get("tax_id") or "").strip() != tax_id:
                continue
            gid = (row.get("GeneID") or "").strip()
            go_id = (row.get("GO_ID") or "").strip()
            if not gid or not go_id or go_id not in slim_ids:
                continue
            by_gene.setdefault(gid, set()).add(go_id)
    return by_gene


def _merge_xrefs(existing: List[str], incoming: List[str]) -> List[str]:
    seen = {str(x) for x in existing or []}
    out = list(existing or [])
    for x in incoming:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _merge_ontology_terms(
    existing: List[Dict[str, Any]], incoming: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    by_id: Dict[str, Dict[str, Any]] = {}
    for term in (existing or []) + incoming:
        if not isinstance(term, dict):
            continue
        tid = term.get("id")
        if not tid:
            continue
        prev = by_id.get(str(tid))
        if prev is None:
            by_id[str(tid)] = dict(term)
        elif term.get("label") and not prev.get("label"):
            prev["label"] = term["label"]
    return list(by_id.values())


def _resolve_ncbi_gene_id(
    feature_id: str,
    ensembl_to_ncbi: Dict[str, str],
) -> Optional[str]:
    fid = str(feature_id).strip()
    if fid.isdigit():
        return fid
    bare = _unversion_ensg(fid)
    if bare in ensembl_to_ncbi:
        return ensembl_to_ncbi[bare]
    if bare.upper().startswith("ENSG"):
        return ensembl_to_ncbi.get(bare)
    return None


def enrich_package(
    package: Path,
    *,
    cache_dir: Path = CACHE_DIR,
    skip_download: bool = False,
) -> Dict[str, int]:
    import pyarrow as pa
    import pyarrow.parquet as pq

    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Missing {manifest_path}")
    with manifest_path.open(encoding="utf-8") as fh:
        manifest = json.load(fh)

    g2e_path = ensure_download(
        GENE2ENSEMBL_URL,
        cache_dir / "gene2ensembl.gz",
        skip_download=skip_download,
    )
    g2go_path = ensure_download(
        GENE2GO_URL,
        cache_dir / "gene2go.gz",
        skip_download=skip_download,
    )
    slim_path = ensure_download(
        GO_SLIM_OBO_URL,
        cache_dir / "goslim_generic.obo",
        skip_download=skip_download,
    )

    ensembl_to_ncbi = load_ensembl_to_ncbi(g2e_path)
    gene_info_by_id = load_gene_info_by_id(cache_dir, skip_download=skip_download)
    gene_info_index = load_gene_info_index(cache_dir, skip_download=skip_download)
    slim_ids = load_goslim_ids(slim_path)
    go_labels = parse_so_obo(slim_path)
    gene_go = load_gene2go_slim(g2go_path, slim_ids=slim_ids)

    stats = {"features_updated": 0, "genes_updated": 0, "go_terms_added": 0}

    def enrich_row(row: Dict[str, Any]) -> Dict[str, Any]:
        fid = str(row.get("feature_id") or "")
        ncbi = _resolve_ncbi_gene_id(fid, ensembl_to_ncbi)
        xrefs = list(row.get("xrefs") or [])
        if ncbi and ncbi in gene_info_by_id:
            xrefs = _merge_xrefs(xrefs, gene_info_by_id[ncbi]["xrefs"])
        else:
            symbol = row.get("symbol")
            if symbol:
                sym = str(symbol).strip()
                rec = gene_info_index.by_symbol.get(sym)
                if rec is None:
                    rec = gene_info_index.by_symbol_upper_unique.get(sym.upper())
                if rec is not None:
                    xrefs = _merge_xrefs(xrefs, rec.xrefs)
        row["xrefs"] = xrefs
        ont = list(row.get("ontology_terms") or [])
        if ncbi and ncbi in gene_go:
            go_terms = [
                {"id": go_id, "label": go_labels.get(go_id, go_id)}
                for go_id in sorted(gene_go[ncbi])
            ]
            stats["go_terms_added"] += len(go_terms)
            ont = _merge_ontology_terms(ont, go_terms)
        row["ontology_terms"] = ont
        return row

    genes_path = package / "genes.parquet"
    if genes_path.is_file():
        genes = pq.read_table(genes_path).to_pylist()
        changed = False
        for i, row in enumerate(genes):
            before = json.dumps(row.get("xrefs"), sort_keys=True)
            genes[i] = enrich_row(dict(row))
            after = json.dumps(genes[i].get("xrefs"), sort_keys=True)
            if before != after or genes[i].get("ontology_terms"):
                changed = True
                stats["genes_updated"] += 1
        if changed:
            pq.write_table(
                pa.Table.from_pylist(genes), genes_path, compression="zstd"
            )

    for entry in manifest.get("matrices") or []:
        dirname = entry.get("dir")
        if not dirname:
            continue
        feat_path = package / "matrices" / dirname / "features.parquet"
        if not feat_path.is_file():
            continue
        feats = pq.read_table(feat_path).to_pylist()
        changed = False
        for i, row in enumerate(feats):
            updated = enrich_row(dict(row))
            if updated != row:
                feats[i] = updated
                changed = True
                stats["features_updated"] += 1
        if changed:
            pq.write_table(
                pa.Table.from_pylist(feats), feat_path, compression="zstd"
            )

    return stats


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Enrich gene xrefs and GO slim terms")
    p.add_argument("--package", type=Path, required=True)
    p.add_argument("--skip-download", action="store_true")
    p.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    stats = enrich_package(
        args.package,
        cache_dir=args.cache_dir,
        skip_download=args.skip_download,
    )
    print(
        f"Gene annotation enrich: features={stats['features_updated']} "
        f"genes={stats['genes_updated']} go_terms_added={stats['go_terms_added']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
