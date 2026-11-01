"""Sequence Ontology helpers: load so.obo and resolve GFF type / biotype maps."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from parsers.base import CACHE_DIR, download_file

SCRIPTS_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPTS_DIR / "data"

SO_OBO_URL = (
    "https://raw.githubusercontent.com/The-Sequence-Ontology/SO-Ontologies/"
    "master/Ontology_Files/so.obo"
)

FALLBACK_FEATURE_TYPE = ("SO:0000704", "gene")

_GFF_TYPE_MAP: Optional[Dict[str, Dict[str, str]]] = None
_BIOTYPE_MAP: Optional[Dict[str, Dict[str, str]]] = None
_OBO_NAMES: Optional[Dict[str, str]] = None


def _norm_key(token: str) -> str:
    return (token or "").strip().lower().replace("-", "_").replace(" ", "_")


def _load_json_map(path: Path) -> Dict[str, Dict[str, str]]:
    with path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    out: Dict[str, Dict[str, str]] = {}
    for key, val in raw.items():
        if not isinstance(val, dict) or not val.get("id"):
            raise ValueError(f"{path.name}: invalid entry for {key!r}")
        out[_norm_key(key)] = {
            "id": str(val["id"]),
            "label": str(val.get("label") or val["id"]),
        }
    return out


def gff_type_map() -> Dict[str, Dict[str, str]]:
    global _GFF_TYPE_MAP
    if _GFF_TYPE_MAP is None:
        _GFF_TYPE_MAP = _load_json_map(DATA_DIR / "gff_type_to_so.json")
    return _GFF_TYPE_MAP


def biotype_map() -> Dict[str, Dict[str, str]]:
    global _BIOTYPE_MAP
    if _BIOTYPE_MAP is None:
        _BIOTYPE_MAP = _load_json_map(DATA_DIR / "biotype_to_so.json")
    return _BIOTYPE_MAP


def parse_so_obo(path: Path) -> Dict[str, str]:
    """Return SO id -> name from an OBO file."""
    names: Dict[str, str] = {}
    cur_id: Optional[str] = None
    cur_name: Optional[str] = None
    alt_ids: list[str] = []

    def _flush() -> None:
        nonlocal cur_id, cur_name, alt_ids
        if cur_id and cur_name:
            names[cur_id] = cur_name
            for alt in alt_ids:
                names[alt] = cur_name
        cur_id = None
        cur_name = None
        alt_ids = []

    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line == "[Term]":
                _flush()
                continue
            if line.startswith("[") and line.endswith("]"):
                _flush()
                continue
            if line.startswith("id: "):
                cur_id = line[4:].strip()
            elif line.startswith("name: "):
                cur_name = line[6:].strip()
            elif line.startswith("alt_id: "):
                alt_ids.append(line[8:].strip())
        _flush()
    return names


def ensure_so_obo(
    *,
    cache_dir: Path = CACHE_DIR,
    skip_download: bool = False,
) -> Path:
    return download_file(
        SO_OBO_URL,
        cache_dir=cache_dir,
        skip_download=skip_download,
        timeout=(30, 600),
    )


def load_obo_names(
    *,
    cache_dir: Path = CACHE_DIR,
    skip_download: bool = False,
    force: bool = False,
) -> Dict[str, str]:
    global _OBO_NAMES
    if _OBO_NAMES is not None and not force:
        return _OBO_NAMES
    path = ensure_so_obo(cache_dir=cache_dir, skip_download=skip_download)
    _OBO_NAMES = parse_so_obo(path)
    return _OBO_NAMES


def validate_maps_against_obo(obo_names: Dict[str, str]) -> None:
    missing = []
    for label, mapping in (
        ("gff_type_to_so.json", gff_type_map()),
        ("biotype_to_so.json", biotype_map()),
    ):
        for key, entry in mapping.items():
            so_id = entry["id"]
            if so_id not in obo_names:
                missing.append(f"{label}:{key}->{so_id}")
    if missing:
        raise SystemExit(
            "SO map id(s) missing from so.obo: " + ", ".join(missing[:20])
            + (f" (+{len(missing) - 20} more)" if len(missing) > 20 else "")
        )


def init_so_maps(
    *,
    cache_dir: Path = CACHE_DIR,
    skip_download: bool = False,
) -> Dict[str, str]:
    """Load OBO, validate committed maps, cache names for label enrichment."""
    names = load_obo_names(cache_dir=cache_dir, skip_download=skip_download, force=True)
    validate_maps_against_obo(names)
    return names


def _with_obo_label(so_id: str, fallback_label: str, obo_names: Optional[Dict[str, str]]) -> str:
    if obo_names and so_id in obo_names:
        return obo_names[so_id]
    return fallback_label


def resolve_feature_type(
    col3: str,
    *,
    obo_names: Optional[Dict[str, str]] = None,
) -> Tuple[str, str]:
    """Map GFF/GTF column-3 feature type to SO featureType (never biotype)."""
    names = obo_names if obo_names is not None else _OBO_NAMES
    key = _norm_key(col3)
    entry = gff_type_map().get(key)
    if entry:
        return entry["id"], _with_obo_label(entry["id"], entry["label"], names)
    # Soft fallback for unknown column-3 tokens.
    return (
        FALLBACK_FEATURE_TYPE[0],
        _with_obo_label(FALLBACK_FEATURE_TYPE[0], FALLBACK_FEATURE_TYPE[1], names),
    )


def resolve_biotype_ontology(
    biotype: str,
    *,
    obo_names: Optional[Dict[str, str]] = None,
) -> Optional[Tuple[str, str]]:
    """Map gene_type / gene_biotype to an SO ontologyTerms entry, or None."""
    if not biotype:
        return None
    names = obo_names if obo_names is not None else _OBO_NAMES
    entry = biotype_map().get(_norm_key(biotype))
    if not entry:
        return None
    return entry["id"], _with_obo_label(entry["id"], entry["label"], names)


def label_for_so_id(
    so_id: str,
    *,
    obo_names: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    names = obo_names if obo_names is not None else _OBO_NAMES
    if not so_id:
        return None
    if names and so_id in names:
        return names[so_id]
    return None


def ontology_term_dict(so_id: str, label: Optional[str] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"id": so_id}
    if label:
        out["label"] = label
    return out
