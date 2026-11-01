"""v1 enrichment for Parquet export: gene symbols + biosample ontology."""

from __future__ import annotations

import csv
import gzip
import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

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


def ensure_gene_info_path(
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
    timeout: int = 600,
) -> Path:
    """Download (if needed) and return path to Homo_sapiens.gene_info.gz."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / _safe_filename(NCBI_GENE_INFO_URL)
    if dest.exists():
        return dest
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
    return dest


def _normalize_gene_info_xrefs(raw: str) -> List[str]:
    """Normalize gene_info dbXrefs (pipe-separated) to CURIE-ish strings."""
    curies: List[str] = []
    seen: Set[str] = set()
    if not raw or raw == "-":
        return curies
    for token in raw.split("|"):
        token = token.strip()
        if not token or ":" not in token:
            continue
        prefix, rest = token.split(":", 1)
        prefix_l = prefix.lower().replace("_", "")
        if prefix_l in ("geneid", "ncbigene", "ncbigeneid"):
            curie = f"NCBIGene:{rest}"
        elif prefix_l == "hgnc":
            # HGNC:HGNC:11998 → HGNC:11998
            if rest.upper().startswith("HGNC:"):
                curie = f"HGNC:{rest.split(':', 1)[1]}"
            else:
                curie = f"HGNC:{rest}"
        elif prefix_l in ("ensembl", "ensemblgene"):
            curie = f"ENSEMBL:{rest}"
        elif prefix_l == "mim":
            curie = f"MIM:{rest}"
        elif prefix_l == "mirbase":
            curie = f"miRBase:{rest}"
        elif prefix.lower() == "imgt/gene-db":
            curie = f"IMGT/GENE-DB:{rest}"
        elif prefix_l == "alliancegenome":
            # Skip redundant AllianceGenome:HGNC:N mirrors
            continue
        else:
            curie = token
        if curie not in seen:
            seen.add(curie)
            curies.append(curie)
    return curies


@dataclass
class GeneInfoRow:
    gene_id: str
    symbol: str
    synonyms: List[str] = field(default_factory=list)
    xrefs: List[str] = field(default_factory=list)
    type_of_gene: Optional[str] = None


@dataclass
class GeneInfoIndex:
    by_symbol: Dict[str, GeneInfoRow]
    by_symbol_upper_unique: Dict[str, GeneInfoRow]
    ambiguous_symbols: Set[str]
    ambiguous_upper: Set[str]


def load_gene_info_index(
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
    timeout: int = 600,
) -> GeneInfoIndex:
    """Index gene_info by unique primary Symbol for GENCODE enrichment."""
    path = ensure_gene_info_path(
        cache_dir, skip_download=skip_download, timeout=timeout
    )
    by_symbol_lists: Dict[str, List[GeneInfoRow]] = {}
    with _open_text(path) as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            gid = (row.get("GeneID") or "").strip()
            symbol = (row.get("Symbol") or "").strip()
            if not gid or not symbol:
                continue
            syn_raw = (row.get("Synonyms") or "").strip()
            synonyms: List[str] = []
            if syn_raw and syn_raw != "-":
                for part in re.split(r"[|]", syn_raw):
                    part = part.strip()
                    if part and part != symbol:
                        synonyms.append(part)
            rec = GeneInfoRow(
                gene_id=gid,
                symbol=symbol,
                synonyms=synonyms,
                xrefs=_normalize_gene_info_xrefs(row.get("dbXrefs") or ""),
                type_of_gene=(row.get("type_of_gene") or "").strip() or None,
            )
            # Always include NCBIGene
            ncbi = f"NCBIGene:{gid}"
            if ncbi not in rec.xrefs:
                rec.xrefs.insert(0, ncbi)
            by_symbol_lists.setdefault(symbol, []).append(rec)

    by_symbol: Dict[str, GeneInfoRow] = {}
    ambiguous: Set[str] = set()
    for sym, rows in by_symbol_lists.items():
        if len(rows) == 1:
            by_symbol[sym] = rows[0]
        else:
            ambiguous.add(sym)

    # Uppercase fallback only when a single unique row maps to that upper key
    upper_lists: Dict[str, List[GeneInfoRow]] = {}
    for sym, rec in by_symbol.items():
        upper_lists.setdefault(sym.upper(), []).append(rec)
    by_upper: Dict[str, GeneInfoRow] = {}
    ambiguous_upper: Set[str] = set(s.upper() for s in ambiguous)
    for usym, rows in upper_lists.items():
        if usym in ambiguous_upper:
            continue
        if len(rows) == 1:
            by_upper[usym] = rows[0]
        else:
            ambiguous_upper.add(usym)

    return GeneInfoIndex(
        by_symbol=by_symbol,
        by_symbol_upper_unique=by_upper,
        ambiguous_symbols=ambiguous,
        ambiguous_upper=ambiguous_upper,
    )


def load_geo_gene_symbols(
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
    timeout: int = 600,
) -> Dict[str, str]:
    """Map NCBI GeneID -> Symbol from Homo_sapiens.gene_info.gz."""
    path = ensure_gene_info_path(
        cache_dir, skip_download=skip_download, timeout=timeout
    )
    mapping: Dict[str, str] = {}
    with _open_text(path) as fh:
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
