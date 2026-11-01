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


# Beacon biosample.sampleOriginType — OBI material-entity categories.
_OBI_SPECIMEN = {"id": "OBI:0001479", "label": "specimen from organism"}
_OBI_CELL_CULTURE = {"id": "OBI:0001876", "label": "cell culture"}

GEO_ONTOLOGY_MAP_PATH = Path(__file__).resolve().parent / "data" / "geo_biosample_ontology.json"
ENCODE_BIOSAMPLE_URL = "https://www.encodeproject.org/biosamples/{accession}/?format=json"
# NCBI text dump of all GSMs in a series (more reliable than FTP soft.gz here).
GEO_SOFT_URL = (
    "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi"
    "?acc={accession}&targ=gsm&form=text&view=full"
)
GTEX_SAMPLE_ATTRIBUTES_URL = (
    "https://storage.googleapis.com/adult-gtex/annotations/v8/metadata-files/"
    "GTEx_Analysis_v8_Annotations_SampleAttributesDS.txt"
)


def _pair_or_none(
    oid: Any,
    label: Any,
    *,
    context: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Return (id, label) only when both are non-empty; else (None, None) + warn."""
    oid_s = str(oid).strip() if oid is not None else ""
    label_s = str(label).strip() if label is not None else ""
    if oid_s and label_s:
        return oid_s, label_s
    if oid_s and not label_s:
        print(
            f"WARNING: skipping ontology id without label ({context}): {oid_s}",
            flush=True,
        )
    return None, None


def _ontology_source_for_id(oid: Optional[str], fallback: Optional[str] = None) -> Optional[str]:
    if not oid:
        return fallback
    if oid.startswith("EFO:"):
        return "EFO"
    if oid.startswith("UBERON:"):
        return "UBERON"
    return fallback


def _load_geo_ontology_map(path: Path = GEO_ONTOLOGY_MAP_PATH) -> Dict[str, Dict[str, str]]:
    if not path.is_file():
        print(f"WARNING: GEO ontology map missing: {path}", flush=True)
        return {}
    import json

    raw = json.loads(path.read_text(encoding="utf-8"))
    out: Dict[str, Dict[str, str]] = {}
    for key, entry in raw.items():
        if key.startswith("_") or not isinstance(entry, dict):
            continue
        oid = (entry.get("id") or "").strip()
        label = (entry.get("label") or "").strip()
        source = (entry.get("source") or "").strip()
        if not oid or not label:
            print(
                f"WARNING: GEO map entry {key!r} missing required id/label; skipped",
                flush=True,
            )
            continue
        out[key.strip().lower()] = {
            "id": oid,
            "label": label,
            "source": source or (_ontology_source_for_id(oid) or ""),
        }
    return out


def ensure_encode_biosample_json(
    accession: str,
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
    timeout: int = 60,
) -> Optional[Dict[str, Any]]:
    """Fetch/cache ENCODE ENCBS JSON; return parsed dict or None on failure."""
    acc = (accession or "").strip()
    if not acc:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"encode_biosample_{acc}.json"
    if not dest.exists():
        if skip_download:
            print(
                f"WARNING: ENCODE biosample cache miss for {acc} ({dest})",
                flush=True,
            )
            return None
        url = ENCODE_BIOSAMPLE_URL.format(accession=acc)
        try:
            resp = requests.get(
                url,
                timeout=timeout,
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            dest.write_bytes(resp.content)
        except Exception as exc:
            print(f"WARNING: ENCODE biosample fetch failed for {acc}: {exc}", flush=True)
            return None
    try:
        import json

        return json.loads(dest.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"WARNING: ENCODE biosample JSON parse failed for {acc}: {exc}", flush=True)
        return None


def encode_biosample_ontology(
    accession: str,
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Return (term_id, term_name, ontology_source) from ENCBS biosample_ontology."""
    data = ensure_encode_biosample_json(
        accession, cache_dir, skip_download=skip_download
    )
    if not data:
        return None, None, None
    ont = data.get("biosample_ontology") or {}
    if not isinstance(ont, dict):
        return None, None, None
    oid, label = _pair_or_none(
        ont.get("term_id"),
        ont.get("term_name"),
        context=f"ENCODE {accession} biosample_ontology",
    )
    if not oid:
        return None, None, None
    return oid, label, _ontology_source_for_id(oid, "EFO")


def ensure_geo_soft_path(
    accession: str,
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
    timeout: int = 120,
) -> Optional[Path]:
    """Download/cache GEO series SOFT-like text (all GSMs) for ``accession``."""
    acc = (accession or "").strip().upper()
    if not acc:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"{acc}_family.soft"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    # Accept previously cached .soft.gz if present.
    dest_gz = cache_dir / f"{acc}_family.soft.gz"
    if dest_gz.exists() and dest_gz.stat().st_size > 0:
        return dest_gz
    if skip_download:
        print(f"WARNING: GEO SOFT cache miss for {acc}", flush=True)
        return None
    url = GEO_SOFT_URL.format(accession=acc)
    try:
        with requests.get(url, stream=True, timeout=timeout) as resp:
            resp.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".partial")
            try:
                with tmp.open("wb") as out:
                    for chunk in resp.iter_content(chunk_size=256 * 1024):
                        if chunk:
                            out.write(chunk)
                if tmp.stat().st_size == 0:
                    tmp.unlink(missing_ok=True)
                    print(f"WARNING: empty GEO SOFT download for {acc}", flush=True)
                    return None
                tmp.replace(dest)
            except Exception:
                if tmp.exists():
                    tmp.unlink(missing_ok=True)
                raise
        return dest
    except Exception as exc:
        print(f"WARNING: GEO SOFT fetch failed for {acc}: {exc}", flush=True)
        return None


def parse_geo_soft_characteristics(path: Path) -> Dict[str, List[str]]:
    """Map GSM accession → list of ``!Sample_characteristics_ch1`` values."""
    out: Dict[str, List[str]] = {}
    gsm: Optional[str] = None
    with _open_text(path) as fh:
        for line in fh:
            if line.startswith("^SAMPLE"):
                gsm = line.split("=", 1)[-1].strip()
                out.setdefault(gsm, [])
            elif line.startswith("!Sample_characteristics_ch1") and gsm:
                val = line.split("=", 1)[-1].strip()
                if val:
                    out.setdefault(gsm, []).append(val)
    return out


def _normalize_soft_kv_key(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.strip().lower())


def parse_geo_soft_characteristics_kv(path: Path) -> Dict[str, Dict[str, str]]:
    """Map GSM → normalized key → value from ``key: value`` characteristics."""
    out: Dict[str, Dict[str, str]] = {}
    gsm: Optional[str] = None
    with _open_text(path) as fh:
        for line in fh:
            if line.startswith("^SAMPLE"):
                gsm = line.split("=", 1)[-1].strip()
                out.setdefault(gsm, {})
            elif line.startswith("!Sample_characteristics_ch1") and gsm:
                val = line.split("=", 1)[-1].strip()
                if not val or ":" not in val:
                    continue
                key, rest = val.split(":", 1)
                nk = _normalize_soft_kv_key(key)
                out[gsm][nk] = rest.strip()
    return out


def ensure_gtex_sample_attributes_path(
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
    timeout: int = 300,
) -> Optional[Path]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / "GTEx_Analysis_v8_Annotations_SampleAttributesDS.txt"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    if skip_download:
        print(f"WARNING: GTEx sample attributes cache miss: {dest}", flush=True)
        return None
    try:
        with requests.get(GTEX_SAMPLE_ATTRIBUTES_URL, stream=True, timeout=timeout) as resp:
            resp.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".partial")
            try:
                with tmp.open("wb") as out:
                    for chunk in resp.iter_content(chunk_size=256 * 1024):
                        if chunk:
                            out.write(chunk)
                tmp.replace(dest)
            except Exception:
                if tmp.exists():
                    tmp.unlink(missing_ok=True)
                raise
        return dest
    except Exception as exc:
        print(f"WARNING: GTEx sample attributes fetch failed: {exc}", flush=True)
        return None


def load_gtex_sample_attributes(
    cache_dir: Path = CACHE_DIR,
    *,
    skip_download: bool = False,
) -> Dict[str, Dict[str, Any]]:
    """Map GTEx SAMPID → {sex, age_bracket, rin, ischemic_time_min, tissue_detail}."""
    path = ensure_gtex_sample_attributes_path(cache_dir, skip_download=skip_download)
    if path is None:
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            samp = (row.get("SAMPID") or "").strip()
            if not samp:
                continue
            rec: Dict[str, Any] = {}
            sex_raw = (row.get("SEX") or "").strip()
            if sex_raw == "1":
                rec["sex"] = "male"
            elif sex_raw == "2":
                rec["sex"] = "female"
            age = (row.get("AGE") or "").strip()
            if age:
                rec["age_bracket"] = age
            rin = (row.get("SMRIN") or "").strip()
            if rin:
                try:
                    rec["rin"] = float(rin)
                except ValueError:
                    pass
            isch = (row.get("SMTSISCH") or row.get("SMATSSCR") or "").strip()
            if isch:
                try:
                    rec["ischemic_time_min"] = float(isch)
                except ValueError:
                    rec["ischemic_time_min"] = isch
            tsd = (row.get("SMTSD") or "").strip()
            if tsd:
                rec["tissue_detail"] = tsd
            subj = (row.get("SUBJID") or "").strip()
            if subj:
                rec["donor"] = subj
            if rec:
                out[samp] = rec
    return out


def lookup_geo_ontology(
    characteristics: List[str],
    ontology_map: Dict[str, Dict[str, str]],
) -> Optional[Dict[str, str]]:
    """Prefer UBERON tissue hits over EFO when both map for a GSM."""
    uberon: Optional[Dict[str, str]] = None
    efo: Optional[Dict[str, str]] = None
    for raw in characteristics:
        key = raw.strip().lower()
        entry = ontology_map.get(key)
        if not entry:
            continue
        src = (entry.get("source") or "").upper()
        if src == "UBERON" and uberon is None:
            uberon = entry
        elif src == "EFO" and efo is None:
            efo = entry
        elif uberon is None and efo is None:
            # Unknown source but valid id+label — keep as last resort.
            efo = entry
    return uberon or efo


def enrich_biosamples(
    biosamples: List[Dict[str, Any]],
    *,
    matrix_id: str,
    profile: Dict[str, Any],
    profile_name: str,
    cache_dir: Path = CACHE_DIR,
    skip_download: bool = False,
) -> List[Dict[str, Any]]:
    """Build biosample rows with Beacon-shaped origin type/detail columns.

    Ontology-only enrichment: ``ontology_id`` / ``ontology_label`` hold
    sampleOriginDetail (tissue / cell line); ``sample_origin_type_*`` holds the
    OBI material category. Never emits an id without a label.
    """
    tissue = profile.get("tissue") or {}
    rows: List[Dict[str, Any]] = []

    geo_chars: Dict[str, List[str]] = {}
    geo_kv: Dict[str, Dict[str, str]] = {}
    geo_map: Dict[str, Dict[str, str]] = {}
    gtex_attrs: Dict[str, Dict[str, Any]] = {}
    if profile_name == "geo":
        geo_map = _load_geo_ontology_map()
        soft = ensure_geo_soft_path(
            str(matrix_id),
            cache_dir,
            skip_download=skip_download,
        )
        if soft is not None:
            geo_chars = parse_geo_soft_characteristics(soft)
            geo_kv = parse_geo_soft_characteristics_kv(soft)
    elif profile_name == "gtex":
        gtex_attrs = load_gtex_sample_attributes(
            cache_dir, skip_download=skip_download
        )

    for sample in biosamples:
        sid = sample.get("id") or sample.get("biosampleId")
        ontology_id = None
        ontology_label = None
        ontology_source = None
        sex = sample.get("sex")
        donor = sample.get("donor")
        summary = sample.get("summary")
        lab = sample.get("lab")
        age_bracket = None
        condition = None
        timepoint = None
        rin = None
        ischemic_time_min = None
        origin_type = _OBI_SPECIMEN

        if profile_name == "encode":
            origin_type = _OBI_CELL_CULTURE
            enc_id, enc_label, enc_src = encode_biosample_ontology(
                str(sid or ""),
                cache_dir,
                skip_download=skip_download,
            )
            if enc_id:
                ontology_id, ontology_label, ontology_source = enc_id, enc_label, enc_src
            else:
                st = sample.get("sampleType") or {}
                if isinstance(st, dict):
                    oid, olabel = _pair_or_none(
                        st.get("id"),
                        st.get("label"),
                        context=f"encode catalog sampleType for {sid}",
                    )
                    if oid:
                        ontology_id, ontology_label = oid, olabel
                        ontology_source = _ontology_source_for_id(oid)
        elif profile_name == "gtex":
            origin_type = _OBI_SPECIMEN
            t = sample.get("tissue") or sample.get("sampleType") or tissue
            if isinstance(t, dict):
                oid, olabel = _pair_or_none(
                    t.get("id"),
                    t.get("label"),
                    context=f"gtex tissue for {sid}",
                )
                if oid:
                    ontology_id, ontology_label = oid, olabel
                    ontology_source = _ontology_source_for_id(oid, "UBERON")
            else:
                print(
                    f"WARNING: gtex profile missing tissue id+label for {sid}",
                    flush=True,
                )
            ga = gtex_attrs.get(str(sid), {})
            if ga.get("sex") and not sex:
                sex = ga["sex"]
            if ga.get("donor") and not donor:
                donor = ga["donor"]
            age_bracket = ga.get("age_bracket")
            rin = ga.get("rin")
            ischemic_time_min = ga.get("ischemic_time_min")
            if ga.get("tissue_detail") and not summary:
                summary = str(ga["tissue_detail"])
        elif profile_name == "geo":
            origin_type = _OBI_SPECIMEN
            ontology_source = "GEO"
            chars = geo_chars.get(str(sid), [])
            hit = lookup_geo_ontology(chars, geo_map) if chars else None
            if hit:
                oid, olabel = _pair_or_none(
                    hit.get("id"),
                    hit.get("label"),
                    context=f"geo map for {sid}",
                )
                if oid:
                    ontology_id, ontology_label = oid, olabel
                    ontology_source = hit.get("source") or _ontology_source_for_id(oid)
            kv = geo_kv.get(str(sid), {})
            infection = kv.get("infection") or kv.get("treatment") or kv.get("condition")
            if infection:
                condition = infection.strip()
            timepoint = kv.get("time point") or kv.get("timepoint")
            severity = kv.get("disease severity") or kv.get("severity")
            if severity and not condition:
                condition = severity.strip()
            summary = (profile.get("series_design") or "").strip() or summary

        rows.append(
            {
                "biosample_id": sid,
                "matrix_id": matrix_id,
                "ontology_id": ontology_id,
                "ontology_label": ontology_label,
                "ontology_source": ontology_source,
                "sample_origin_type_id": origin_type["id"],
                "sample_origin_type_label": origin_type["label"],
                "sex": sex,
                "donor": donor,
                "summary": summary,
                "lab": lab,
                "age_bracket": age_bracket,
                "condition": condition,
                "timepoint": timepoint,
                "rin": rin,
                "ischemic_time_min": ischemic_time_min,
            }
        )
    return rows
