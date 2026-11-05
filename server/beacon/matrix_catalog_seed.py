"""Seed matrix filtering terms from scripts/profiles/datasets.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore


def _datasets_yaml_path() -> Path:
    return (
        Path(__file__).resolve().parents[2] / "scripts" / "profiles" / "datasets.yaml"
    )


def _ontology_term(raw: Any) -> Optional[Tuple[str, str, str]]:
    """Return (type, id, label) for assay_type / feature_type blocks."""
    if not isinstance(raw, dict):
        return None
    oid = raw.get("id")
    if not oid:
        return None
    oid = str(oid)
    if ":" not in oid:
        return None
    pref = oid.split(":", 1)[0].upper()
    if pref not in ("OBI", "SO"):
        return None
    label = str(raw.get("label") or oid)
    return pref, oid, label


def _feature_type_entries(raw: Any) -> List[Tuple[str, str, str]]:
    out: List[Tuple[str, str, str]] = []
    if isinstance(raw, list):
        for item in raw:
            t = _ontology_term(item)
            if t:
                out.append(t)
    else:
        t = _ontology_term(raw)
        if t:
            out.append(t)
    return out


def load_matrix_seed_terms(
    yaml_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    path = yaml_path or _datasets_yaml_path()
    if yaml is None or not path.is_file():
        return []
    with path.open(encoding="utf-8") as fh:
        doc = yaml.safe_load(fh) or {}
    profiles = doc.get("profiles") or []
    terms_by_id: Dict[str, Dict[str, Any]] = {}
    profile_sources: set[str] = set()

    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        src = profile.get("source")
        if src:
            profile_sources.add(str(src))
        assay = _ontology_term(profile.get("assay_type"))
        if assay:
            type_, oid, label = assay
            terms_by_id.setdefault(
                oid,
                {
                    "type": type_,
                    "id": oid,
                    "label": label,
                    "scopes": ["matrix"],
                },
            )
        for type_, oid, label in _feature_type_entries(profile.get("feature_type")):
            terms_by_id.setdefault(
                oid,
                {
                    "type": type_,
                    "id": oid,
                    "label": label,
                    "scopes": ["matrix"],
                },
            )

    terms = list(terms_by_id.values())
    if profile_sources:
        terms.append(
            {
                "type": "custom",
                "id": "matrix.profileSource",
                "label": "Data source",
                "scopes": ["matrix"],
                "values": sorted(profile_sources),
            }
        )
    return sorted(terms, key=lambda t: (t.get("id") or "", t.get("type") or ""))


def merge_filtering_terms(
    primary: List[Dict[str, Any]], seed: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Merge seed terms into primary; primary wins on labels and value lists."""
    by_id: Dict[str, Dict[str, Any]] = {}
    for term in seed:
        tid = str(term.get("id") or "")
        if tid:
            by_id[tid] = dict(term)
    for term in primary:
        tid = str(term.get("id") or "")
        if not tid:
            continue
        existing = by_id.get(tid)
        if existing is None:
            by_id[tid] = dict(term)
            continue
        merged = dict(existing)
        if term.get("label"):
            merged["label"] = term["label"]
        if term.get("values"):
            seed_vals = list(existing.get("values") or [])
            live_vals = list(term.get("values") or [])
            merged["values"] = sorted(set(seed_vals + live_vals))
        for key in ("type", "scopes"):
            if term.get(key):
                merged[key] = term[key]
        by_id[tid] = merged
    return sorted(by_id.values(), key=lambda t: (t.get("id") or "", t.get("type") or ""))
