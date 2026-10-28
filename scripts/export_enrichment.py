"""v1 enrichment for Parquet export: gene symbols + biosample ontology."""

from __future__ import annotations

import csv
import gzip
import io
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from parsers.base import CACHE_DIR, _safe_filename

# NCBI GeneID → Symbol (FTP; reliable vs GEO download interstitial HTML)
NCBI_GENE_INFO_URL = (
    "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Homo_sapiens.gene_info.gz"
)


def _open_text(path: Path):
    if path.name.endswith(".gz") or str(path).endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def load_geo_gene_symbols(
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
    timeout: int = 600,
) -> Dict[str, str]:
    """Map NCBI GeneID -> Symbol from Homo_sapiens.gene_info.gz."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / _safe_filename(NCBI_GENE_INFO_URL)
    if not dest.exists():
        if skip_download:
            raise FileNotFoundError(
                f"NCBI gene_info cache miss: {dest}. Run without --skip-download."
            )
        with requests.get(NCBI_GENE_INFO_URL, stream=True, timeout=timeout) as resp:
            resp.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".partial")
            try:
                with tmp.open("wb") as out:
                    for chunk in resp.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            out.write(chunk)
                tmp.replace(dest)
            except Exception:
                if tmp.exists():
                    tmp.unlink(missing_ok=True)
                raise

    mapping: Dict[str, str] = {}
    with _open_text(dest) as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            gid = (row.get("GeneID") or "").strip()
            symbol = (row.get("Symbol") or "").strip()
            if gid and symbol:
                mapping[gid] = symbol
    return mapping


def _feature_type_parts(feature_type: Any) -> Tuple[Optional[str], Optional[str]]:
    if isinstance(feature_type, list):
        feature_type = feature_type[0] if feature_type else None
    if isinstance(feature_type, dict):
        return (
            str(feature_type["id"]) if feature_type.get("id") is not None else None,
            str(feature_type["label"]) if feature_type.get("label") is not None else None,
        )
    if feature_type is None:
        return None, None
    return None, str(feature_type)


def enrich_features(
    features: List[Dict[str, Any]],
    *,
    matrix_id: str,
    profile_name: str,
    gene_symbols: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Build feature rows for features.parquet."""
    rows: List[Dict[str, Any]] = []
    gene_symbols = gene_symbols or {}
    for feat in features:
        native = str(feat.get("nativeId") or "")
        aliases = list(feat.get("aliases") or [])
        symbol = None
        # Prefer explicit gene symbol in aliases (GTEx Description), else map
        if profile_name == "geo" and native in gene_symbols:
            symbol = gene_symbols[native]
        elif aliases:
            # encode/gtex: unversioned ENSG first, symbol often second
            for a in aliases:
                if a and not str(a).startswith("ENSG") and not str(a).isdigit():
                    symbol = str(a)
                    break
        ft_id, ft_label = _feature_type_parts(feat.get("featureType"))
        rows.append(
            {
                "feature_id": native,
                "wrapper_id": feat.get("id"),
                "resource": feat.get("resource"),
                "symbol": symbol,
                "aliases": aliases,
                "feature_type_id": ft_id,
                "feature_type_label": ft_label,
                "matrix_id": matrix_id,
            }
        )
    return rows


def enrich_biosamples(
    biosamples: List[Dict[str, Any]],
    *,
    matrix_id: str,
    profile: Dict[str, Any],
    profile_name: str,
) -> List[Dict[str, Any]]:
    """Build biosample rows with v1 ontology enrichment."""
    tissue = profile.get("tissue") or {}
    rows: List[Dict[str, Any]] = []

    for sample in biosamples:
        sid = sample.get("id") or sample.get("biosampleId")
        ontology_id = None
        ontology_label = None
        ontology_source = None
        sex = sample.get("sex")
        donor = sample.get("donor")
        summary = sample.get("summary")
        lab = sample.get("lab")

        if profile_name == "encode":
            st = sample.get("sampleType") or {}
            if isinstance(st, dict):
                ontology_id = st.get("id")
                ontology_label = st.get("label")
                ontology_source = "EFO" if ontology_id and str(ontology_id).startswith("EFO") else None
            sex = sex or sample.get("sex")
            donor = donor or sample.get("donor")
            summary = summary or sample.get("summary")
            lab = lab or sample.get("lab")
        elif profile_name == "gtex":
            t = sample.get("tissue") or sample.get("sampleType") or tissue
            if isinstance(t, dict):
                ontology_id = t.get("id")
                ontology_label = t.get("label")
                ontology_source = (
                    "UBERON" if ontology_id and str(ontology_id).startswith("UBERON") else None
                )
        elif profile_name == "geo":
            # Series-level tag only in v1 (no per-GSM SOFT parse)
            ontology_id = None
            ontology_label = "GEO sample"
            ontology_source = "GEO"
            summary = (profile.get("series_design") or "").strip() or summary

        rows.append(
            {
                "biosample_id": sid,
                "matrix_id": matrix_id,
                "ontology_id": ontology_id,
                "ontology_label": ontology_label,
                "ontology_source": ontology_source,
                "sex": sex,
                "donor": donor,
                "summary": summary,
                "lab": lab,
            }
        )
    return rows
