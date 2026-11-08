"""Shared wide-matrix parsing and profile loading."""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, FrozenSet, Iterable, Iterator, List, Optional, Tuple, Union

import requests
import yaml

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
PROFILES_DIR = SCRIPTS_DIR / "profiles"
DATASETS_PATH = PROFILES_DIR / "datasets.yaml"
CACHE_DIR = SCRIPTS_DIR / ".cache"

_PARSERS: Dict[str, Callable[[Dict[str, Any], Path, int, int], "NormalizedMatrix"]] = {}


def register_parser(name: str):
    def decorator(fn):
        _PARSERS[name] = fn
        return fn

    return decorator


def get_parser(name: str):
    if name not in _PARSERS:
        raise KeyError(f"Unknown parser source '{name}'. Known: {sorted(_PARSERS)}")
    return _PARSERS[name]


def profile_source(profile: Dict[str, Any]) -> Optional[str]:
    """Return the parser/source id for a catalog record (`source`, legacy `profile`)."""
    value = profile.get("source") or profile.get("profile")
    return str(value) if value else None


_DEFAULT_FEATURE_TYPE = {"id": "SO:0000704", "label": "gene"}


def profile_feature_types(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return matrix featureTypes seed from profile ``feature_types`` (list of ontology terms)."""
    raw = profile.get("feature_types")
    if raw is None:
        raise ValueError(
            f"profile {profile.get('matrix_id')!r}: feature_types list is required"
        )
    if not isinstance(raw, list) or not raw:
        raise ValueError(
            f"profile {profile.get('matrix_id')!r}: feature_types must be a non-empty list"
        )
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict) or not item.get("id"):
            raise ValueError(
                f"profile {profile.get('matrix_id')!r}: each feature_types entry needs id"
            )
        term = {"id": str(item["id"])}
        if item.get("label"):
            term["label"] = str(item["label"])
        out.append(term)
    return out


def profile_primary_feature_type(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Default featureType seed (first profile feature_types entry)."""
    types = profile_feature_types(profile)
    return dict(types[0]) if types else dict(_DEFAULT_FEATURE_TYPE)


def _annotate_record(record: Dict[str, Any], path: Path) -> Dict[str, Any]:
    data = dict(record)
    data["_profile_path"] = str(path)
    return data


def _records_from_yaml(data: Any, path: Path) -> List[Dict[str, Any]]:
    if isinstance(data, dict) and isinstance(data.get("profiles"), list):
        records = data["profiles"]
    elif isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        return [_annotate_record(data, path)]
    else:
        return []
    out: List[Dict[str, Any]] = []
    for item in records:
        if isinstance(item, dict):
            out.append(_annotate_record(item, path))
    return out


def load_datasets(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Load all matrix records from the profiles catalog."""
    catalog = Path(path) if path else DATASETS_PATH
    if not catalog.exists():
        raise FileNotFoundError(f"Datasets catalog not found: {catalog}")
    with catalog.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    records = _records_from_yaml(data, catalog)
    if not records:
        raise ValueError(f"No profile records in catalog: {catalog}")
    seen_ids: Dict[str, str] = {}
    for record in records:
        mid = record.get("matrix_id")
        if not mid:
            continue
        mid_s = str(mid)
        src = profile_source(record) or "?"
        if mid_s in seen_ids:
            raise ValueError(
                f"Duplicate matrix_id {mid_s!r} in {catalog} "
                f"(sources {seen_ids[mid_s]!r} and {src!r})"
            )
        seen_ids[mid_s] = src
    return records


def list_sources(path: Optional[Path] = None) -> List[str]:
    """Unique `source` values from the catalog, in first-seen order."""
    seen: Dict[str, None] = {}
    for record in load_datasets(path):
        src = profile_source(record)
        if src and src not in seen:
            seen[src] = None
    return list(seen.keys())


def load_profiles_for_sources(
    sources: List[str],
    *,
    path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Return every catalog record whose source is in ``sources`` (catalog order)."""
    wanted = {s.strip() for s in sources if s and s.strip()}
    if not wanted:
        return []
    return [r for r in load_datasets(path) if profile_source(r) in wanted]


def load_profile(
    name: Optional[str] = None,
    config_path: Optional[Path] = None,
    *,
    matrix_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Load one matrix profile.

    - ``config_path`` pointing at a single-record YAML returns that record.
    - ``config_path`` pointing at a catalog (top-level ``profiles:``) filters by
      ``name`` / ``matrix_id`` like the built-in catalog.
    - ``name`` alone selects the first catalog record with that ``source``.
    """
    if config_path:
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Profile not found: {path}")
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        records = _records_from_yaml(data, path)
        if isinstance(data, dict) and isinstance(data.get("profiles"), list):
            if not name and not matrix_id:
                raise ValueError(
                    f"Catalog {path} requires a source name and/or matrix_id "
                    "to select a record"
                )
            if name:
                records = [r for r in records if profile_source(r) == name]
            if matrix_id:
                records = [r for r in records if r.get("matrix_id") == matrix_id]
            if not records:
                raise ValueError(
                    f"No profile matched in {path}"
                    + (f" source={name!r}" if name else "")
                    + (f" matrix_id={matrix_id!r}" if matrix_id else "")
                )
            if len(records) > 1:
                ids = [r.get("matrix_id") for r in records]
                raise ValueError(
                    f"Ambiguous catalog match in {path}: {ids}. "
                    "Pass matrix_id to select one."
                )
            return records[0]
        if not records:
            raise ValueError(f"Empty profile YAML: {path}")
        return records[0]

    if not name:
        raise ValueError("Provide --profile or --config")

    matches = load_profiles_for_sources([name])
    if matrix_id:
        matches = [r for r in matches if r.get("matrix_id") == matrix_id]
    if not matches:
        known = list_sources()
        raise FileNotFoundError(
            f"No catalog profile for source {name!r}"
            + (f" matrix_id={matrix_id!r}" if matrix_id else "")
            + f". Known sources: {known}"
        )
    return matches[0]


@dataclass
class NormalizedMatrix:
    matrix: Dict[str, Any]
    features: List[Dict[str, Any]]
    biosamples: List[Dict[str, Any]]
    # rows: (matrix_id, feature_id_native, biosample_id, value)
    # May be a list or a lazy iterator (e.g. GTEx full-tissue stream).
    expression_rows: Iterable[Tuple[str, str, str, float]] = field(default_factory=list)


def _safe_filename(url: str) -> str:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    name = url.rstrip("/").split("/")[-1] or "matrix.tsv"
    name = re.sub(r"[^\w.\-]+", "_", name)
    return f"{digest}_{name}"


def _file_md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_checksum(path: Path, download_cfg: Dict[str, Any]) -> None:
    """Raise ValueError if path fails profile md5/sha256 checks."""
    expected_md5 = (download_cfg or {}).get("md5")
    expected_sha = (download_cfg or {}).get("sha256")
    if expected_md5:
        got = _file_md5(path)
        if got.lower() != str(expected_md5).lower():
            raise ValueError(
                f"MD5 mismatch for {path.name}: expected {expected_md5}, got {got}"
            )
    if expected_sha:
        got = _file_sha256(path)
        if got.lower() != str(expected_sha).lower():
            raise ValueError(
                f"SHA256 mismatch for {path.name}: expected {expected_sha}, got {got}"
            )


def resolve_source_file(
    download_cfg: Dict[str, Any],
    *,
    cache_dir: Path = CACHE_DIR,
    skip_download: bool = False,
    timeout: int = 600,
) -> Path:
    """Resolve a local path or download URL into a cached file path."""
    download_cfg = download_cfg or {}
    local = download_cfg.get("path")
    if local:
        path = Path(local)
        if not path.is_absolute():
            path = (SCRIPTS_DIR / path).resolve()
        if not path.exists():
            raise FileNotFoundError(f"download.path not found: {path}")
        verify_checksum(path, download_cfg)
        return path

    url = download_cfg.get("url") or ""
    return download_file(
        url,
        cache_dir=cache_dir,
        skip_download=skip_download,
        timeout=timeout,
        download_cfg=download_cfg,
    )


DOWNLOAD_USER_AGENT = "rnaget-beacon-demo/export"


def download_file(
    url: str,
    *,
    cache_dir: Path = CACHE_DIR,
    skip_download: bool = False,
    timeout: Union[float, Tuple[float, float]] = (30, 600),
    download_cfg: Optional[Dict[str, Any]] = None,
) -> Path:
    if not url or url.startswith("stub:"):
        raise ValueError(
            f"Download URL is stubbed or empty ({url!r}). "
            "Set download.url (or download.path) in the profile YAML to a real matrix file."
        )
    download_cfg = download_cfg or {}
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / _safe_filename(url)

    def _ok_cached() -> bool:
        if not dest.exists():
            return False
        try:
            verify_checksum(dest, download_cfg)
            return True
        except ValueError:
            dest.unlink(missing_ok=True)
            return False

    if skip_download:
        if not dest.exists():
            raise FileNotFoundError(
                f"--skip-download set but cache miss: {dest}. "
                "Run once without --skip-download to populate scripts/.cache/."
            )
        verify_checksum(dest, download_cfg)
        return dest

    if _ok_cached():
        return dest

    tmp = dest.with_suffix(dest.suffix + ".partial")
    try:
        with requests.get(
            url,
            stream=True,
            timeout=timeout,
            headers={"User-Agent": DOWNLOAD_USER_AGENT},
        ) as resp:
            resp.raise_for_status()
            with tmp.open("wb") as out:
                for chunk in resp.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        out.write(chunk)
        verify_checksum(tmp, download_cfg)
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise
    return dest


def _open_text(path: Path) -> io.TextIOBase:
    if path.name.endswith(".gz") or str(path).endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def _slug(value: str) -> str:
    return re.sub(r"[^\w.\-]+", "_", value.strip())[:120] or "id"


def _iter_wide_matrix_data_rows(path: Path, *, delim: str) -> Iterator[List[str]]:
    """Yield data rows from a wide matrix file (header and # comments skipped)."""
    with _open_text(path) as fh:
        first = fh.readline()
        while first.startswith("#"):
            first = fh.readline()
        reader = csv.reader(io.StringIO(first), delimiter=delim)
        next(reader)  # column header
        rest_reader = csv.reader(fh, delimiter=delim)
        for row in rest_reader:
            if row:
                yield row


def _iter_wide_matrix_expression(
    path: Path,
    *,
    matrix_id: str,
    profile: Dict[str, Any],
    sample_names: List[str],
    allowed_native_ids: Optional[FrozenSet[str]] = None,
) -> Iterator[Tuple[str, str, str, float]]:
    """Second pass over a wide matrix: stream (matrix, gene, sample, value) tuples."""
    delim = profile.get("delimiter") or "\t"
    feature_col = int(profile.get("feature_column", 0))
    sample_start = int(profile.get("sample_start_column", feature_col + 1))
    n_samples = len(sample_names)

    for row in _iter_wide_matrix_data_rows(path, delim=delim):
        if len(row) <= sample_start:
            continue
        native_id = row[feature_col].strip()
        if not native_id:
            continue
        if allowed_native_ids is not None and native_id not in allowed_native_ids:
            continue
        values = row[sample_start : sample_start + n_samples]
        for sample_id, raw in zip(sample_names, values):
            raw = (raw or "").strip()
            if raw == "" or raw.upper() == "NA":
                continue
            try:
                value = float(raw)
            except ValueError:
                continue
            yield (matrix_id, native_id, sample_id, value)


def parse_wide_matrix(
    path: Path,
    profile: Dict[str, Any],
    *,
    max_genes: int,
    max_samples: int,
) -> NormalizedMatrix:
    """Parse gene × sample TSV/CSV: first column = feature id, rest = samples."""
    matrix_id = profile["matrix_id"]
    delim = profile.get("delimiter") or "\t"
    resource = (profile.get("annotation") or {}).get("source") or "local"
    feature_types = profile_feature_types(profile)
    feature_type = profile_primary_feature_type(profile)
    # Full GEO/NCBI matrices (~40k × 100+ samples) materialize ~5M Python tuples
    # if expression is buffered; stream on a second file pass when unsliced.
    stream_expression = max_genes == 0 and max_samples == 0

    with _open_text(path) as fh:
        # Skip comment lines (common in GTEx)
        sample_fh = fh
        first = sample_fh.readline()
        while first.startswith("#"):
            first = sample_fh.readline()
        reader = csv.reader(io.StringIO(first), delimiter=delim)
        header = next(reader)
        rest_reader = csv.reader(sample_fh, delimiter=delim)

        if len(header) < 2:
            raise ValueError(f"Expected wide matrix with >=2 columns in {path}")

        feature_col = int(profile.get("feature_column", 0))
        sample_start = int(profile.get("sample_start_column", feature_col + 1))
        sample_names = header[sample_start:]
        if max_samples > 0:
            sample_names = sample_names[:max_samples]
        n_samples = len(sample_names)

        features: List[Dict[str, Any]] = []
        expression_rows_list: List[Tuple[str, str, str, float]] = []
        gene_count = 0

        for row in rest_reader:
            if not row or len(row) <= sample_start:
                continue
            native_id = row[feature_col].strip()
            if not native_id:
                continue
            gene_count += 1
            if max_genes > 0 and gene_count > max_genes:
                break

            wrapper_id = f"feature-{_slug(native_id)}"
            features.append(
                {
                    "id": wrapper_id,
                    "nativeId": native_id,
                    "resource": resource,
                    "featureIdentifier": {"id": native_id, "resource": resource},
                    "featureType": feature_type,
                    "matrixIds": [matrix_id],
                }
            )

            if not stream_expression:
                values = row[sample_start : sample_start + n_samples]
                for sample_id, raw in zip(sample_names, values):
                    raw = (raw or "").strip()
                    if raw == "" or raw.upper() == "NA":
                        continue
                    try:
                        value = float(raw)
                    except ValueError:
                        continue
                    expression_rows_list.append(
                        (matrix_id, native_id, sample_id, value)
                    )

    if stream_expression:
        allowed: Optional[FrozenSet[str]] = frozenset(
            f["nativeId"] for f in features if f.get("nativeId")
        )
        expression_rows: Iterable[Tuple[str, str, str, float]] = (
            _iter_wide_matrix_expression(
                path,
                matrix_id=matrix_id,
                profile=profile,
                sample_names=sample_names,
                allowed_native_ids=allowed,
            )
        )
    else:
        expression_rows = expression_rows_list

    biosamples = [
        {"id": sid, "biosampleId": sid, "matrixIds": [matrix_id]} for sid in sample_names
    ]

    unit = profile.get("unit") or "raw"
    scale = profile.get("scale") or "linear"
    annotation = profile.get("annotation") or {"source": resource, "version": "unknown"}
    assembly = profile.get("assembly") or {
        "accession": "GCA_000001405.29",
        "name": "GRCh38.p14",
    }
    assay_type = profile.get("assay_type") or {
        "id": "OBI:0003090",
        "label": "bulk RNA-seq assay",
    }

    matrix = {
        "matrixId": matrix_id,
        "name": profile.get("name") or matrix_id,
        "description": profile.get("description") or "",
        "downloadUrl": (profile.get("download") or {}).get("url") or "",
        "expressionUnitAndScale": {"unit": unit, "scale": scale},
        "featureTypes": feature_types,
        "annotation": annotation,
        "assembly": assembly,
        "assayType": assay_type,
        "reproducible": bool(profile.get("reproducible", False)),
        "dimensions": {
            "features": len(features),
            "biosamples": len(biosamples),
        },
        "info": {
            "source": profile_source(profile),
            "sourceFile": str(path.name),
            "sliced": bool(
                (max_genes and max_genes > 0) or (max_samples and max_samples > 0)
            ),
            "maxGenes": max_genes,
            "maxSamples": max_samples,
            # Upper bound (genes × samples); NA/invalid cells may be omitted.
            "expectedExpressionCells": len(features) * len(biosamples),
            **({"expressionStreaming": True} if stream_expression else {}),
        },
    }

    return NormalizedMatrix(
        matrix=matrix,
        features=features,
        biosamples=biosamples,
        expression_rows=expression_rows,
    )


def resolve_slice(
    profile: Dict[str, Any],
    max_genes: Optional[int],
    max_samples: Optional[int],
) -> Tuple[int, int]:
    """Resolve slice limits from CLI overrides or profile.

    max_genes / max_samples of 0 means unlimited (no cap).
    Negative values are rejected.
    """
    slice_cfg = profile.get("slice") or {}
    genes = max_genes if max_genes is not None else int(slice_cfg.get("max_genes", 500))
    samples = (
        max_samples if max_samples is not None else int(slice_cfg.get("max_samples", 20))
    )
    if genes < 0 or samples < 0:
        raise ValueError(
            f"Slice limits must be >= 0 (0 = unlimited); got max_genes={genes}, "
            f"max_samples={samples}"
        )
    return genes, samples

