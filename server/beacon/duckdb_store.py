"""DuckDB-backed Beacon store over a Parquet data package."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import duckdb

from beacon.filters import (
    EXPRESSION_BIOSAMPLE_ALPHANUMERIC,
    EXPRESSION_FEATURE_ALPHANUMERIC,
    EXPRESSION_VALUE_ALPHANUMERIC,
    axis_filter_scope,
)

logger = logging.getLogger(__name__)

# Cap page size for expression / feature list endpoints (also enforced in deps).
MAX_PAGE_LIMIT = 1000
MAX_SKIP = 100_000
MAX_ID_LIST_TOKENS = 200
# Cap intermediate id sets built in Python / DISTINCT before an IN list.
MAX_INTERMEDIATE_IDS = MAX_PAGE_LIMIT
# Explore probe caches (package is immutable for the process lifetime).
_FEATURE_ID_LIST_CACHE_MAX = 256
_HYDRATED_FEATURE_CACHE_MAX = 4096

BIOSAMPLE_HYDRATE_COLS: Tuple[str, ...] = (
    "biosample_id",
    "ontology_id",
    "ontology_label",
    "ontology_source",
    "sample_origin_type_id",
    "sample_origin_type_label",
    "biosample_status_id",
    "biosample_status_label",
    "phenotype_ids",
    "phenotype_labels",
    "phenotypic_ontology_ids",
    "phenotypic_features",
    "sample_processing_id",
    "sample_processing_label",
    "collection_date",
    "measurements",
    "measurement_assay_ids",
    "sex",
    "donor",
    "summary",
    "lab",
    "age_bracket",
    "condition",
    "timepoint",
    "rin",
    "ischemic_time_min",
)

AXIS_SORT_VALUES = frozenset({"id", "expression.min", "expression.max"})
AXIS_ORDER_VALUES = frozenset({"asc", "desc"})


def _csv_tokens(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [part.strip() for part in str(value).split(",") if part.strip()]


def normalize_axis_sort(
    sort: Optional[str] = None, order: Optional[str] = None
) -> Tuple[str, str]:
    s = (sort or "id").strip()
    o = (order or "asc").strip().lower()
    if s not in AXIS_SORT_VALUES:
        s = "id"
    if o not in AXIS_ORDER_VALUES:
        o = "asc"
    return s, o


def normalize_expression_value_order(order: Optional[str] = None) -> str:
    """Expression values are always ordered by cell value; ``order`` is direction."""
    o = (order or "asc").strip().lower()
    if o not in AXIS_ORDER_VALUES:
        o = "asc"
    return o


def degrade_axis_sort_if_no_stats(
    sort_key: str, *, has_stats: bool
) -> str:
    """Fall back to id sort when expression.* is requested but stats are missing."""
    if sort_key.startswith("expression.") and not has_stats:
        return "id"
    return sort_key


@dataclass
class ExpressionValuesPage:
    """Result of an expression_values page fetch (cursor + offset paging)."""

    results: List[Dict[str, Any]]
    total: int
    next_page: Optional[str] = None
    previous_page: Optional[str] = None


_PAGE_TOKEN_VERSION = 1


def encode_page_token(payload: Dict[str, Any]) -> str:
    """Opaque base64url (no padding) JSON page token."""
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_page_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Decode a page token; returns ``None`` if malformed (never raises)."""
    if not token:
        return None
    try:
        padded = token + "=" * (-len(str(token)) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        return payload
    except Exception:
        return None


def compute_filter_hash(*parts: Any) -> str:
    """Stable short hash of the query shape a page token was minted under."""
    raw = json.dumps(parts, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def _csv_set(value: Optional[str]) -> Set[str]:
    if not value:
        return set()
    return {part.strip() for part in value.split(",") if part.strip()}


def _safe_view(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


def _sql_path(path: Path) -> str:
    """Escape a filesystem path for interpolation into DuckDB SQL string literals."""
    return path.resolve().as_posix().replace("'", "''")


def _is_nan(value: Any) -> bool:
    try:
        return value != value
    except Exception:
        return False


_CONTIG_MAP_PATH = (
    Path(__file__).resolve().parent / "data" / "grch38_contig_to_refseq.json"
)
_CONTIG_TO_REFSEQ: Optional[Dict[str, str]] = None


def _contig_to_refseq() -> Dict[str, str]:
    global _CONTIG_TO_REFSEQ
    if _CONTIG_TO_REFSEQ is None:
        if _CONTIG_MAP_PATH.is_file():
            _CONTIG_TO_REFSEQ = json.loads(
                _CONTIG_MAP_PATH.read_text(encoding="utf-8")
            )
        else:
            logger.warning("Missing contig map at %s", _CONTIG_MAP_PATH)
            _CONTIG_TO_REFSEQ = {}
    return _CONTIG_TO_REFSEQ


def build_genomic_interval(
    chrom: Any, start: Any, end: Any, strand: Any
) -> Optional[Dict[str, Any]]:
    """Build Beacon genomicInterval (VRS SequenceLocation) from GFF coords."""
    if chrom is None or _is_nan(chrom) or start is None or end is None:
        return None
    if _is_nan(start) or _is_nan(end):
        return None
    try:
        start_i = int(start)
        end_i = int(end)
    except (TypeError, ValueError):
        return None
    if start_i > end_i:
        start_i, end_i = end_i, start_i
    chrom_s = str(chrom)
    seq_id = _contig_to_refseq().get(chrom_s)
    if not seq_id and chrom_s.lower().startswith("chr"):
        seq_id = _contig_to_refseq().get(chrom_s[3:])
    if not seq_id and chrom_s.lower().startswith("refseq:"):
        seq_id = chrom_s
    if not seq_id and chrom_s.upper().startswith(("NC_", "NZ_", "NT_", "NW_")):
        # NCBI GFF often uses bare RefSeq accessions as seqid
        seq_id = f"refseq:{chrom_s}"
    if not seq_id:
        return None
    strand_s = None if strand is None or _is_nan(strand) else str(strand)
    if strand_s not in ("positive", "negative"):
        strand_s = "positive"
    return {
        "location": {
            "type": "SequenceLocation",
            "sequence_id": seq_id,
            "interval": {
                "type": "SequenceInterval",
                "start": {"type": "Number", "value": start_i - 1},
                "end": {"type": "Number", "value": end_i},
            },
        },
        "strand": strand_s,
    }


class DuckDBStore:
    """Read-only store backed by DATA_PACKAGE_PATH Parquet + matrices.json."""

    def __init__(self, package_path: Path):
        self.package_path = Path(package_path).resolve()
        if not (self.package_path / "manifest.json").is_file():
            raise FileNotFoundError(
                f"DATA_PACKAGE_PATH missing manifest.json: {self.package_path}"
            )

        self.manifest = json.loads(
            (self.package_path / "manifest.json").read_text(encoding="utf-8")
        )
        self.matrices: List[Dict[str, Any]] = json.loads(
            (self.package_path / "matrices.json").read_text(encoding="utf-8")
        )
        self._matrices_by_id = {m["matrixId"]: m for m in self.matrices}

        self._matrix_dirs: Dict[str, Path] = {}
        self._manifest_expr_rows: Dict[str, int] = {}
        for entry in self.manifest.get("matrices") or []:
            mid = entry.get("matrix_id")
            dirname = entry.get("dir")
            if mid and dirname:
                self._matrix_dirs[mid] = self.package_path / "matrices" / dirname
            if mid and entry.get("expressionRows") is not None:
                self._manifest_expr_rows[mid] = int(entry["expressionRows"])

        # DDL during startup stays on the primary connection. Queries use a
        # cursor each (DuckDB duplicates the connection) so reads are not
        # serialised behind one lock.
        self._lock = threading.Lock()
        self.con = duckdb.connect(database=":memory:")
        self._view_column_cache: Dict[str, Set[str]] = {}
        self._biosample_counts: Dict[str, int] = {}
        self._dense_cache: Dict[str, bool] = {}
        self._axis_terms_cache: Dict[
            Tuple[str, str], Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]
        ] = {}
        from beacon.duckdb_settings import configure_duckdb_connection

        configure_duckdb_connection(self.con)
        self._expr_views: Dict[str, str] = {}
        self._feat_views: Dict[str, str] = {}
        self._bio_views: Dict[str, str] = {}
        self._feat_stats_views: Dict[str, str] = {}
        self._bio_stats_views: Dict[str, str] = {}
        self._tissue_stats_views: Dict[str, str] = {}
        self._tissue_summary_view: Optional[str] = None
        self._tissue_labels_view: Optional[str] = None
        self._pct_feat_views: Dict[str, str] = {}
        self._pct_bio_views: Dict[str, str] = {}
        self._all_features_view: Optional[str] = None
        self._all_biosamples_view: Optional[str] = None
        self._has_gene_lookup: bool = False
        self._has_genes: bool = False
        self._has_feature_indexes: bool = False
        self._has_biosample_indexes: bool = False
        self._feature_index_view: Optional[str] = None
        self._feature_ontology_view: Optional[str] = None
        self._feature_matrix_view: Optional[str] = None
        self._biosamples_global_view: Optional[str] = None
        self._biosample_matrix_view: Optional[str] = None
        self._global_feature_count: Optional[int] = None
        self._global_biosample_count: Optional[int] = None
        self._feature_counts: Dict[str, int] = {}
        self._feature_id_list_cache: "OrderedDict[str, Tuple[str, ...]]" = OrderedDict()
        self._hydrated_feature_cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self._package_fingerprint: Optional[str] = None

        self._biosample_matrices: Dict[str, List[str]] = {}
        self._filtering_terms_doc: Optional[Dict[str, Any]] = None
        self._register_views()
        self._load_indexes()
        self._load_filtering_terms()

    def package_fingerprint(self) -> str:
        """Stable hash of package identity for ETag / Cache-Control."""
        if self._package_fingerprint:
            return self._package_fingerprint
        parts = [
            str(self.package_path),
            str(self.manifest.get("builtAt") or ""),
            str(self.manifest.get("version") or ""),
            str((self.manifest.get("tissueFeatureSummary") or {}).get("rowCount") or ""),
            str(len(self.matrices)),
        ]
        digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:24]
        self._package_fingerprint = digest
        return digest

    @staticmethod
    def _lru_get(cache: "OrderedDict[str, Any]", key: str) -> Any:
        if key not in cache:
            return None
        cache.move_to_end(key)
        return cache[key]

    @staticmethod
    def _lru_put(cache: "OrderedDict[str, Any]", key: str, value: Any, max_size: int) -> None:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > max_size:
            cache.popitem(last=False)

    def _execute(self, sql: str, params: Optional[List[Any]] = None):
        """Run SQL under the connection lock; caller must finish fetch before unlock.

        Prefer ``_fetchall`` / ``_fetchone`` for query results so fetch stays locked.
        """
        with self._lock:
            if params is None:
                return self.con.execute(sql)
            return self.con.execute(sql, params)

    def _fetchall(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> Tuple[List[Tuple[Any, ...]], List[str]]:
        cur = self.con.cursor()
        try:
            rel = cur.execute(sql) if params is None else cur.execute(sql, params)
            cols = [c[0] for c in (rel.description or [])]
            return rel.fetchall(), cols
        finally:
            cur.close()

    def _fetchone(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> Optional[Tuple[Any, ...]]:
        cur = self.con.cursor()
        try:
            rel = cur.execute(sql) if params is None else cur.execute(sql, params)
            return rel.fetchone()
        finally:
            cur.close()

    def _register_views(self) -> None:
        genes = self.package_path / "genes.parquet"
        lookup = self.package_path / "gene_lookup.parquet"
        if genes.is_file():
            self._execute(
                f"CREATE VIEW genes AS SELECT * FROM read_parquet('{_sql_path(genes)}')"
            )
            self._has_genes = True
        if lookup.is_file():
            self._execute(
                f"CREATE VIEW gene_lookup AS SELECT * FROM read_parquet('{_sql_path(lookup)}')"
            )
            self._has_gene_lookup = True

        # Optional precomputed global indexes (preferred over UNION ALL / UNNEST).
        fo = self.package_path / (
            self.manifest.get("featureOntologyPath") or "feature_ontology.parquet"
        )
        fi = self.package_path / (
            self.manifest.get("featureIndexPath") or "feature_index.parquet"
        )
        fm = self.package_path / (
            self.manifest.get("featureMatrixPath") or "feature_matrix.parquet"
        )
        if fo.is_file() and fi.is_file() and fm.is_file():
            self._execute(
                f"CREATE VIEW feature_ontology AS SELECT * FROM read_parquet('{_sql_path(fo)}')"
            )
            self._execute(
                f"CREATE VIEW feature_index AS SELECT * FROM read_parquet('{_sql_path(fi)}')"
            )
            self._execute(
                f"CREATE VIEW feature_matrix AS SELECT * FROM read_parquet('{_sql_path(fm)}')"
            )
            self._feature_ontology_view = "feature_ontology"
            self._feature_index_view = "feature_index"
            self._feature_matrix_view = "feature_matrix"
            self._has_feature_indexes = True

        tissue_summary_meta = self.manifest.get("tissueFeatureSummary") or {}
        tissue_summary_name = (
            tissue_summary_meta.get("path")
            if isinstance(tissue_summary_meta, dict)
            else None
        ) or "tissue_feature_summary.parquet"
        tissue_labels_name = (
            tissue_summary_meta.get("labelsPath")
            if isinstance(tissue_summary_meta, dict)
            else None
        ) or "tissue_column_labels.parquet"
        tissue_summary = self.package_path / tissue_summary_name
        tissue_labels = self.package_path / tissue_labels_name
        if tissue_summary.is_file():
            # In-memory table sorted for Explore probes (ontology then wrapper).
            self._execute(
                f"""
                CREATE TABLE tissue_summary AS
                SELECT
                  CAST(wrapper_id AS VARCHAR) AS wrapper_id,
                  CAST(ontology_id AS VARCHAR) AS ontology_id,
                  percentile,
                  n_biosamples,
                  n_matrices,
                  level
                FROM read_parquet('{_sql_path(tissue_summary)}')
                ORDER BY ontology_id, wrapper_id
                """
            )
            self._tissue_summary_view = "tissue_summary"
        if tissue_labels.is_file():
            self._execute(
                f"CREATE VIEW tissue_labels AS SELECT * FROM read_parquet('{_sql_path(tissue_labels)}')"
            )
            self._tissue_labels_view = "tissue_labels"

        bg = self.package_path / (
            self.manifest.get("biosamplesPath") or "biosamples.parquet"
        )
        bm = self.package_path / (
            self.manifest.get("biosampleMatrixPath") or "biosample_matrix.parquet"
        )
        if bg.is_file() and bm.is_file():
            self._execute(
                f"CREATE VIEW biosamples_global AS SELECT * FROM read_parquet('{_sql_path(bg)}')"
            )
            self._execute(
                f"CREATE VIEW biosample_matrix AS SELECT * FROM read_parquet('{_sql_path(bm)}')"
            )
            self._biosamples_global_view = "biosamples_global"
            self._biosample_matrix_view = "biosample_matrix"
            self._has_biosample_indexes = True

        for mid, matrix_dir in self._matrix_dirs.items():
            key = _safe_view(mid)
            feat = matrix_dir / "features.parquet"
            bio = matrix_dir / "biosamples.parquet"
            expr = matrix_dir / "expression.parquet"
            if not expr.is_file():
                parts = sorted((matrix_dir / "expression").glob("part-*.parquet"))
                if parts:
                    pattern = matrix_dir / "expression" / "part-*.parquet"
                    v = f"expr_{key}"
                    self._execute(
                        f"CREATE VIEW {v} AS SELECT * FROM read_parquet("
                        f"'{_sql_path(pattern)}', union_by_name := true)"
                    )
                    self._expr_views[mid] = v
                else:
                    raise FileNotFoundError(
                        f"Matrix {mid}: missing expression.parquet "
                        f"(run scripts/fetch_data_package.py or merge_expression_parquet.py)"
                    )
            else:
                v = f"expr_{key}"
                self._execute(
                    f"CREATE VIEW {v} AS SELECT * FROM read_parquet('{_sql_path(expr)}')"
                )
                self._expr_views[mid] = v

            if feat.is_file():
                fv = f"feat_{key}"
                self._execute(
                    f"CREATE VIEW {fv} AS SELECT * FROM read_parquet('{_sql_path(feat)}')"
                )
                self._feat_views[mid] = fv
            if bio.is_file():
                bv = f"bio_{key}"
                self._execute(
                    f"CREATE VIEW {bv} AS SELECT * FROM read_parquet('{_sql_path(bio)}')"
                )
                self._bio_views[mid] = bv
            feat_stats = matrix_dir / "feature_expression_stats.parquet"
            if feat_stats.is_file():
                fsv = f"feat_stats_{key}"
                self._execute(
                    f"CREATE VIEW {fsv} AS SELECT * FROM read_parquet('{_sql_path(feat_stats)}')"
                )
                self._feat_stats_views[mid] = fsv
            bio_stats = matrix_dir / "biosample_expression_stats.parquet"
            if bio_stats.is_file():
                bsv = f"bio_stats_{key}"
                self._execute(
                    f"CREATE VIEW {bsv} AS SELECT * FROM read_parquet('{_sql_path(bio_stats)}')"
                )
                self._bio_stats_views[mid] = bsv
            tissue_stats = matrix_dir / "tissue_expression_stats.parquet"
            if tissue_stats.is_file():
                tsv = f"tissue_stats_{key}"
                self._execute(
                    f"CREATE VIEW {tsv} AS SELECT * FROM read_parquet('{_sql_path(tissue_stats)}')"
                )
                self._tissue_stats_views[mid] = tsv
            # Optional fetch-time percentile files (not shipped in CI packages).
            pct_feat = matrix_dir / "percentile_in_feature.parquet"
            if pct_feat.is_file():
                pfv = f"pct_feat_{key}"
                self._execute(
                    f"CREATE VIEW {pfv} AS SELECT * FROM read_parquet('{_sql_path(pct_feat)}')"
                )
                self._pct_feat_views[mid] = pfv
            pct_bio = matrix_dir / "percentile_in_biosample.parquet"
            if pct_bio.is_file():
                pbv = f"pct_bio_{key}"
                self._execute(
                    f"CREATE VIEW {pbv} AS SELECT * FROM read_parquet('{_sql_path(pct_bio)}')"
                )
                self._pct_bio_views[mid] = pbv

        # Global feature catalog view (SQL-backed; not loaded into Python).
        if self._feat_views:
            parts = []
            for view in self._feat_views.values():
                cols = self._view_columns(view)
                # Typed empty fallbacks so UNNEST/list ops bind on pre-hydrate packages.
                _empty_fallbacks = {
                    "aliases": "CAST([] AS VARCHAR[]) AS aliases",
                    "xrefs": "CAST([] AS VARCHAR[]) AS xrefs",
                    "ontology_terms": (
                        "CAST([] AS STRUCT(id VARCHAR, label VARCHAR)[]) "
                        "AS ontology_terms"
                    ),
                    "chrom": "CAST(NULL AS VARCHAR) AS chrom",
                    "start": 'CAST(NULL AS BIGINT) AS "start"',
                    "end": 'CAST(NULL AS BIGINT) AS "end"',
                    "strand": "CAST(NULL AS VARCHAR) AS strand",
                }
                opt_cols = []
                for name in (
                    "aliases",
                    "xrefs",
                    "ontology_terms",
                    "chrom",
                    "start",
                    "end",
                    "strand",
                ):
                    q = f'"{name}"' if name in ("start", "end") else name
                    if name in cols:
                        opt_cols.append(
                            f"{q} AS {q}" if name in ("start", "end") else name
                        )
                    else:
                        opt_cols.append(_empty_fallbacks[name])
                opt_sql = ", ".join(opt_cols)
                # Core columns that export always writes; fall back if absent.
                core = []
                for name in (
                    "symbol",
                    "resource",
                    "feature_type_id",
                    "feature_type_label",
                ):
                    if name in cols:
                        core.append(name)
                    else:
                        core.append(f"NULL AS {name}")
                core_sql = ", ".join(core)
                parts.append(
                    f"SELECT CAST(feature_id AS VARCHAR) AS feature_id, "
                    f"CAST(wrapper_id AS VARCHAR) AS wrapper_id, "
                    f"{core_sql}, {opt_sql}, "
                    f"CAST(matrix_id AS VARCHAR) AS matrix_id "
                    f"FROM {view}"
                )
            self._all_features_view = "all_features"
            self._execute(
                f"CREATE VIEW {self._all_features_view} AS " + " UNION ALL ".join(parts)
            )

        # Global biosample catalog (SQL-backed; not fully loaded into Python).
        if self._bio_views:
            bio_parts = []
            for mid, view in self._bio_views.items():
                mid_lit = str(mid).replace("'", "''")
                cols = self._view_columns(view)
                optional = []
                for name in (
                    "ontology_id",
                    "ontology_label",
                    "ontology_source",
                    "sex",
                    "donor",
                    "summary",
                    "lab",
                    "sample_origin_type_id",
                    "sample_origin_type_label",
                ):
                    if name in cols:
                        optional.append(name)
                    else:
                        optional.append(f"NULL AS {name}")
                optional_sql = ", ".join(optional)
                bio_parts.append(
                    f"SELECT CAST(biosample_id AS VARCHAR) AS biosample_id, "
                    f"{optional_sql}, "
                    f"CAST('{mid_lit}' AS VARCHAR) AS matrix_id "
                    f"FROM {view}"
                )
            self._all_biosamples_view = "all_biosamples"
            self._execute(
                f"CREATE VIEW {self._all_biosamples_view} AS "
                + " UNION ALL ".join(bio_parts)
            )

    def _view_columns(self, view: str) -> Set[str]:
        cached = self._view_column_cache.get(view)
        if cached is not None:
            return cached
        rows, _ = self._fetchall(f"DESCRIBE {view}")
        # DuckDB DESCRIBE returns column_name as first field
        cols = {str(r[0]) for r in rows if r and r[0] is not None}
        self._view_column_cache[view] = cols
        return cols

    def _biosample_hydrate_columns(self, view: str) -> List[str]:
        avail = self._view_columns(view)
        return [c for c in BIOSAMPLE_HYDRATE_COLS if c in avail]

    def _load_indexes(self) -> None:
        """Load per-matrix feature counts + biosample→matrix membership via SQL.

        Global feature/biosample identity maps are not materialised as full docs
        in Python; prefer package-root index parquets when present.
        """
        for mid, view in self._feat_views.items():
            one = self._fetchone(f"SELECT COUNT(*) FROM {view}")
            self._feature_counts[mid] = int(one[0]) if one else 0

        feat_meta = self.manifest.get("features") or {}
        if self._has_feature_indexes and feat_meta.get("numUnique") is not None:
            self._global_feature_count = int(feat_meta["numUnique"])
        elif self._has_feature_indexes and self._feature_index_view:
            one = self._fetchone(f"SELECT COUNT(*) FROM {self._feature_index_view}")
            self._global_feature_count = int(one[0]) if one else 0

        bio_matrices: Dict[str, Set[str]] = {}
        bio_meta = self.manifest.get("biosamples") or {}
        if self._has_biosample_indexes and self._biosample_matrix_view:
            rows, _ = self._fetchall(
                f"""
                SELECT biosample_id, matrix_id
                FROM {self._biosample_matrix_view}
                """
            )
            for bid, mid in rows:
                if bid is None or mid is None:
                    continue
                bio_matrices.setdefault(str(bid), set()).add(str(mid))
            if bio_meta.get("numUnique") is not None:
                self._global_biosample_count = int(bio_meta["numUnique"])
            elif self._biosamples_global_view:
                one = self._fetchone(
                    f"SELECT COUNT(*) FROM {self._biosamples_global_view}"
                )
                self._global_biosample_count = int(one[0]) if one else 0
        elif self._all_biosamples_view:
            rows, _ = self._fetchall(
                f"""
                SELECT DISTINCT biosample_id, matrix_id
                FROM {self._all_biosamples_view}
                """
            )
            for bid, mid in rows:
                if bid is None or mid is None:
                    continue
                bio_matrices.setdefault(str(bid), set()).add(str(mid))
            one = self._fetchone(
                f"SELECT COUNT(DISTINCT biosample_id) FROM {self._all_biosamples_view}"
            )
            self._global_biosample_count = int(one[0]) if one else 0
        self._biosample_matrices = {
            bid: sorted(mids) for bid, mids in bio_matrices.items()
        }

    @staticmethod
    def _as_list(value: Any) -> List[Any]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        try:
            if hasattr(value, "tolist"):
                return list(value.tolist())
        except Exception:
            pass
        return [value]

    @classmethod
    def _feature_doc_from_row(
        cls, row: Dict[str, Any], matrix_ids: List[str]
    ) -> Dict[str, Any]:
        feature_id = str(row.get("feature_id") or "")
        wrapper_id = row.get("wrapper_id") or f"feature-{feature_id}"
        resource = row.get("resource") or "local"
        symbol = row.get("symbol")
        if symbol is not None and hasattr(symbol, "item"):
            try:
                symbol = symbol.item()
            except Exception:
                symbol = str(symbol)
        if symbol is not None:
            symbol = None if _is_nan(symbol) else str(symbol)
        aliases = [
            str(a)
            for a in cls._as_list(row.get("aliases"))
            if a is not None and not _is_nan(a)
        ]
        if symbol:
            aliases = [symbol] + [alias for alias in aliases if alias != symbol]
        ft_id = row.get("feature_type_id") or "SO:0000704"
        ft_label = row.get("feature_type_label") or "gene"
        if ft_id is not None and _is_nan(ft_id):
            ft_id = "SO:0000704"
        if ft_label is not None and _is_nan(ft_label):
            ft_label = "gene"
        xrefs = [
            str(x)
            for x in cls._as_list(row.get("xrefs"))
            if x is not None and not _is_nan(x)
        ]
        ontology_terms: List[Dict[str, Any]] = []
        for term in cls._as_list(row.get("ontology_terms")):
            if term is None or _is_nan(term):
                continue
            if isinstance(term, dict):
                tid = term.get("id")
                if tid is None or _is_nan(tid):
                    continue
                entry: Dict[str, Any] = {"id": str(tid)}
                label = term.get("label")
                if label is not None and not _is_nan(label):
                    entry["label"] = str(label)
                ontology_terms.append(entry)
            else:
                # Unexpected scalar — skip
                continue
        gf: Dict[str, Any] = {
            "featureIdentifier": {"id": feature_id, "resource": str(resource)},
            "featureType": {"id": str(ft_id), "label": str(ft_label)},
            "aliases": aliases,
        }
        if xrefs:
            gf["xrefs"] = xrefs
        if ontology_terms:
            gf["ontologyTerms"] = ontology_terms
        interval = build_genomic_interval(
            row.get("chrom"), row.get("start"), row.get("end"), row.get("strand")
        )
        if interval:
            gf["genomicInterval"] = interval
        doc: Dict[str, Any] = {
            "id": str(wrapper_id),
            "genomicFeature": gf,
            "matrixIds": list(matrix_ids),
        }
        return doc

    def _matrix_ids_for_wrapper(self, wrapper_id: str) -> List[str]:
        if self._feature_matrix_view:
            rows, _ = self._fetchall(
                f"""
                SELECT DISTINCT matrix_id
                FROM {self._feature_matrix_view}
                WHERE wrapper_id = ?
                ORDER BY matrix_id
                """,
                [wrapper_id],
            )
            return [str(r[0]) for r in rows if r and r[0] is not None]
        view = self._all_features_view
        if not view:
            return []
        rows, _ = self._fetchall(
            f"""
            SELECT DISTINCT matrix_id
            FROM {view}
            WHERE wrapper_id = ?
            ORDER BY matrix_id
            """,
            [wrapper_id],
        )
        return [str(r[0]) for r in rows if r and r[0] is not None]

    def _hydrate_feature_row(
        self, row: Dict[str, Any], matrix_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        wid = str(row.get("wrapper_id") or f"feature-{row.get('feature_id')}")
        if matrix_ids is None:
            raw = row.get("matrix_ids")
            if raw is not None and not _is_nan(raw):
                if isinstance(raw, (list, tuple)):
                    matrix_ids = [str(x) for x in raw]
                else:
                    try:
                        matrix_ids = [str(x) for x in list(raw)]
                    except TypeError:
                        matrix_ids = [str(raw)]
            else:
                matrix_ids = self._matrix_ids_for_wrapper(wid)
        return self._feature_doc_from_row(row, matrix_ids or [])

    @staticmethod
    def _biosample_doc(row: Dict[str, Any]) -> Dict[str, Any]:
        bid = str(row.get("biosample_id") or row.get("id") or "")
        ontology_id = row.get("ontology_id")
        ontology_label = row.get("ontology_label")
        if ontology_id is not None and _is_nan(ontology_id):
            ontology_id = None
        if ontology_label is not None and _is_nan(ontology_label):
            ontology_label = None
        ontology_source = row.get("ontology_source")
        if ontology_source is not None and _is_nan(ontology_source):
            ontology_source = None

        origin_type_id = row.get("sample_origin_type_id")
        origin_type_label = row.get("sample_origin_type_label")
        if origin_type_id is not None and _is_nan(origin_type_id):
            origin_type_id = None
        if origin_type_label is not None and _is_nan(origin_type_label):
            origin_type_label = None
        # Infer OBI category for older packages missing the columns.
        if not origin_type_id:
            src = str(ontology_source or "").upper()
            oid = str(ontology_id or "")
            if src == "EFO" or oid.startswith("EFO:"):
                origin_type_id, origin_type_label = "OBI:0001876", "cell culture"
            else:
                origin_type_id, origin_type_label = (
                    "OBI:0001479",
                    "specimen from organism",
                )

        status_id = row.get("biosample_status_id")
        status_label = row.get("biosample_status_label")
        if status_id is not None and _is_nan(status_id):
            status_id = None
        if status_label is not None and _is_nan(status_label):
            status_label = None
        if not status_id:
            status_id, status_label = "EFO:0009654", "reference sample"

        doc: Dict[str, Any] = {
            "id": bid,
            "biosampleStatus": {
                "id": str(status_id),
                "label": str(status_label or status_id),
            },
            "sampleOriginType": {
                "id": str(origin_type_id),
                "label": str(origin_type_label or origin_type_id),
            },
        }
        if ontology_id or ontology_label:
            detail: Dict[str, Any] = {}
            if ontology_id:
                detail["id"] = str(ontology_id)
            if ontology_label:
                detail["label"] = str(ontology_label)
            if detail.get("id") or detail.get("label"):
                # OntologyTerm requires id; skip detail if GEO-only label with no id.
                if detail.get("id"):
                    doc["sampleOriginDetail"] = detail
        proc_id = row.get("sample_processing_id")
        proc_label = row.get("sample_processing_label")
        if proc_id is not None and not _is_nan(proc_id):
            proc: Dict[str, Any] = {"id": str(proc_id)}
            if proc_label is not None and not _is_nan(proc_label):
                proc["label"] = str(proc_label)
            doc["sampleProcessing"] = proc
        coll = row.get("collection_date")
        if coll is not None and not _is_nan(coll) and str(coll).strip():
            doc["collectionDate"] = str(coll)[:10]
        raw_pheno = row.get("phenotypic_features")
        if raw_pheno is not None and not _is_nan(raw_pheno):
            if isinstance(raw_pheno, str):
                try:
                    import json as _json

                    raw_pheno = _json.loads(raw_pheno)
                except Exception:
                    raw_pheno = None
            if isinstance(raw_pheno, list) and raw_pheno:
                doc["phenotypicFeatures"] = raw_pheno
        raw_meas = row.get("measurements")
        if raw_meas is not None and not _is_nan(raw_meas):
            if isinstance(raw_meas, str):
                try:
                    import json as _json

                    raw_meas = _json.loads(raw_meas)
                except Exception:
                    raw_meas = None
            if isinstance(raw_meas, list) and raw_meas:
                doc["measurements"] = raw_meas
        donor = row.get("donor")
        if donor is not None and not _is_nan(donor):
            doc["individualId"] = str(donor)
        notes = row.get("summary")
        if notes is not None and not _is_nan(notes) and str(notes).strip():
            doc["notes"] = str(notes)
        return doc

    def _recorded_expression_rows(self, matrix_id: str) -> Optional[int]:
        """Row count written by the package build. Never inferred from dimensions."""
        if matrix_id in self._manifest_expr_rows:
            return self._manifest_expr_rows[matrix_id]
        mat = self._matrices_by_id.get(matrix_id) or {}
        pkg = mat.get("package") or (mat.get("info") or {}).get("package") or {}
        if pkg.get("expressionRows") is not None:
            return int(pkg["expressionRows"])
        return None

    def _expression_row_total(self, matrix_id: str) -> Optional[int]:
        recorded = self._recorded_expression_rows(matrix_id)
        if recorded is not None:
            return recorded
        mat = self._matrices_by_id.get(matrix_id) or {}
        dims = mat.get("dimensions") or {}
        n_feat = dims.get("features") or dims.get("nFeatures")
        n_bio = dims.get("biosamples") or dims.get("nBiosamples")
        if n_feat is not None and n_bio is not None:
            return int(n_feat) * int(n_bio)
        return None

    # --- FixtureStore-compatible API ---

    def list_matrices(
        self, filters: Optional[Sequence[Any]] = None
    ) -> List[Dict[str, Any]]:
        from beacon.matrix_catalog import list_matrices_filtered, public_matrix_doc

        extra: Optional[Dict[str, Set[str]]] = None
        if filters:
            # SO biotype terms are dual-scoped to matrix; match against feature-row
            # SO ids (feature_type_id ∪ ontology_terms), not only matrices.featureTypes.
            needs_so = any(
                getattr(f, "kind", None) == "ontology"
                and str(getattr(f, "id", "")).upper().startswith("SO:")
                for f in filters
            )
            if needs_so:
                extra = {}
                for m in self.matrices:
                    mid = str(m.get("matrixId") or m.get("id") or "")
                    if mid:
                        extra[mid] = self._feature_axis_present_ids(mid)
        matched = list_matrices_filtered(
            self.matrices, filters, extra_ontology_ids_by_matrix=extra
        )
        return [public_matrix_doc(m) for m in matched]

    def matrix_filtering_terms(self) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_catalog import build_matrix_filtering_terms

        return build_matrix_filtering_terms(self.matrices)

    def _distinct_values(self, sql: str) -> Set[str]:
        try:
            rows, _ = self._fetchall(sql)
        except duckdb.Error as exc:
            logger.debug("distinct scan skipped: %s", exc)
            return set()
        return {
            str(row[0])
            for row in rows
            if row and row[0] is not None and str(row[0]).strip()
        }

    def _feature_axis_present_ids(self, matrix_id: str) -> Set[str]:
        """Ontology ids used as filtering terms. Gene ids and aliases are not terms."""
        view = self._feat_views.get(matrix_id)
        present: Set[str] = set()
        if not view:
            return present
        cols = self._view_columns(view)
        if "feature_type_id" in cols:
            present |= self._distinct_values(
                f"SELECT DISTINCT CAST(feature_type_id AS VARCHAR) FROM {view} "
                "WHERE feature_type_id IS NOT NULL"
            )
        if "ontology_terms" in cols:
            present |= self._distinct_values(
                f"""
                SELECT DISTINCT CAST(term.id AS VARCHAR)
                FROM {view}, UNNEST(ontology_terms) AS _ot(term)
                WHERE term.id IS NOT NULL
                """
            )
        return present

    def _biosample_axis_facets(
        self, matrix_id: str
    ) -> Tuple[Set[str], Dict[str, Set[str]], Set[Tuple[str, str]]]:
        view = self._bio_views.get(matrix_id)
        present: Set[str] = set()
        alphanumeric: Dict[str, Set[str]] = {}
        sex_ontology_pairs: Set[Tuple[str, str]] = set()
        if not view:
            return present, alphanumeric, sex_ontology_pairs
        cols = self._view_columns(view)
        for col in (
            "ontology_id",
            "sample_origin_type_id",
            "biosample_status_id",
            "sample_processing_id",
        ):
            if col in cols:
                present |= self._distinct_values(
                    f"SELECT DISTINCT CAST({col} AS VARCHAR) FROM {view} "
                    f"WHERE {col} IS NOT NULL"
                )
        for col in (
            "phenotypic_ontology_ids",
            "phenotype_ids",
            "measurement_assay_ids",
        ):
            if col in cols:
                present |= self._distinct_values(
                    f"""
                    SELECT DISTINCT CAST(item AS VARCHAR)
                    FROM {view}, UNNEST({col}) AS _u(item)
                    WHERE item IS NOT NULL
                    """
                )
        return present, alphanumeric, sex_ontology_pairs

    def _tissues_present_for_matrix(self, matrix_id: str) -> Set[str]:
        """Ontology / matrix: column ids present in this matrix (any n >= 1)."""
        from beacon.tissue_catalog import matrix_pseudo_ontology_id

        view = self._tissue_stats_views.get(matrix_id)
        if view:
            rows, _ = self._fetchall(
                f"""
                SELECT DISTINCT CAST(ontology_id AS VARCHAR)
                FROM {view}
                WHERE ontology_id IS NOT NULL
                """
            )
            return {str(r[0]) for r in rows if r and r[0]}
        bio = self._bio_views.get(matrix_id)
        if not bio:
            return set()
        pseudo = matrix_pseudo_ontology_id(matrix_id)
        rows, _ = self._fetchall(
            f"""
            SELECT
              CASE
                WHEN ontology_id IS NULL
                  OR TRIM(CAST(ontology_id AS VARCHAR)) = ''
                THEN ?
                ELSE CAST(ontology_id AS VARCHAR)
              END AS ontology_id
            FROM {bio}
            GROUP BY 1
            """,
            [pseudo],
        )
        return {str(r[0]) for r in rows if r and r[0]}

    def _matrix_allowed_expression_ids(self, matrix_id: str) -> Set[str]:
        """Categorical expression.* ids supported by this matrix's stats parquet."""
        matrix_dir = self._matrix_dirs.get(matrix_id)
        if not matrix_dir:
            return set()
        from beacon.expression_catalog_support import scan_matrix_expression_support

        return scan_matrix_expression_support(matrix_dir).categorical_expression_ids()

    def matrix_axis_filtering_terms(
        self, matrix_id: str, axis: str
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_axis_catalog import (
            _matrix_feature_type_ids,
            _subset_terms,
        )

        if axis not in ("features", "biosamples"):
            return [], []
        if not self.get_matrix(matrix_id):
            return [], []
        cached = self._axis_terms_cache.get((matrix_id, axis))
        if cached is not None:
            return cached
        scope = "genomicFeature" if axis == "features" else "biosample"
        global_terms, global_resources = self.filtering_terms(scopes=[scope])
        allowed_expression_ids = self._matrix_allowed_expression_ids(matrix_id)
        if axis == "features":
            from beacon.matrix_axis_catalog import ensure_matrix_feature_so_terms

            present = self._feature_axis_present_ids(matrix_id)
            matrix_doc = self.get_matrix(matrix_id)
            present |= _matrix_feature_type_ids(matrix_doc)
            present |= self._tissues_present_for_matrix(matrix_id)
            terms, resources = _subset_terms(
                global_terms,
                global_resources,
                present_ids=present,
                alphanumeric={},
                scope="genomicFeature",
                keep_symbol_resource=bool(self._feature_counts.get(matrix_id)),
                allowed_expression_ids=allowed_expression_ids,
            )
            result = ensure_matrix_feature_so_terms(
                terms, resources, matrix=matrix_doc, present_ids=present
            )
        else:
            present, alphanumeric, sex_pairs = self._biosample_axis_facets(matrix_id)
            result = _subset_terms(
                global_terms,
                global_resources,
                present_ids=present,
                alphanumeric=alphanumeric,
                scope="biosample",
                keep_symbol_resource=False,
                sex_ontology_pairs=sex_pairs,
                allowed_expression_ids=allowed_expression_ids,
            )
        self._axis_terms_cache[(matrix_id, axis)] = result
        return result

    def _matrix_filtering_terms_path(self, matrix_id: str) -> Path:
        safe = str(matrix_id).replace("/", "_")
        return self.package_path / "filtering_terms" / "by_matrix" / f"{safe}.json"

    def matrix_scoped_filtering_terms(
        self, matrix_id: str
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_axis_catalog import (
            ensure_matrix_feature_so_terms,
            merge_matrix_scoped_filtering_terms,
        )

        matrix_doc = self.get_matrix(matrix_id)
        if not matrix_doc:
            return [], []
        packaged = self._matrix_filtering_terms_path(matrix_id)
        if packaged.is_file():
            try:
                with packaged.open(encoding="utf-8") as fh:
                    doc = json.load(fh)
                terms = list(doc.get("filteringTerms") or [])
                resources = list(doc.get("resources") or [])
                # Keep featureTypes SO visible even on older by_matrix packages.
                terms, resources = ensure_matrix_feature_so_terms(
                    terms, resources, matrix=matrix_doc, present_ids=None
                )
                return terms, resources
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning(
                    "Failed to load packaged matrix filtering_terms %s: %s",
                    packaged,
                    exc,
                )
        feat_terms, feat_resources = self.matrix_axis_filtering_terms(
            matrix_id, "features"
        )
        bio_terms, bio_resources = self.matrix_axis_filtering_terms(
            matrix_id, "biosamples"
        )
        return merge_matrix_scoped_filtering_terms(
            feat_terms, feat_resources, bio_terms, bio_resources
        )

    def get_matrix(self, matrix_id: str) -> Optional[Dict[str, Any]]:
        from beacon.matrix_catalog import public_matrix_doc

        raw = self._matrices_by_id.get(matrix_id)
        if raw is None:
            return None
        return public_matrix_doc(raw)

    _FT_RESOURCE_DEFS: Dict[str, Dict[str, str]] = {
        "so": {
            "id": "so",
            "name": "Sequence Ontology",
            "nameSpacePrefix": "SO",
            "iriPrefix": "http://purl.obolibrary.org/obo/SO_",
            "url": "http://purl.obolibrary.org/obo/so.obo",
        },
        "go": {
            "id": "go",
            "name": "Gene Ontology",
            "nameSpacePrefix": "GO",
            "iriPrefix": "http://purl.obolibrary.org/obo/GO_",
            "url": "http://purl.obolibrary.org/obo/go.owl",
        },
        "obi": {
            "id": "obi",
            "name": "Ontology for Biomedical Investigations",
            "nameSpacePrefix": "OBI",
            "iriPrefix": "http://purl.obolibrary.org/obo/OBI_",
            "url": "http://purl.obolibrary.org/obo/obi.owl",
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
        "ncit": {
            "id": "ncit",
            "name": "NCI Thesaurus",
            "nameSpacePrefix": "NCIT",
            "iriPrefix": "http://purl.obolibrary.org/obo/NCIT_",
            "url": "https://evs.nci.nih.gov/ftp1/NCI_Thesaurus",
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
        "symbol": {
            "id": "symbol",
            "name": "Gene symbol",
            "nameSpacePrefix": "symbol",
            "iriPrefix": "https://www.genenames.org/tools/search/#!/?query=",
            "url": "https://www.genenames.org",
        },
    }

    def _load_filtering_terms(self) -> None:
        path = self.package_path / "filtering_terms.json"
        if path.is_file():
            with path.open(encoding="utf-8") as fh:
                self._filtering_terms_doc = json.load(fh)
            return
        logger.warning(
            "filtering_terms.json missing under %s; building SQL DISTINCT facets",
            self.package_path,
        )
        self._filtering_terms_doc = self._build_filtering_terms_from_sql()

    def _build_filtering_terms_from_sql(self) -> Dict[str, Any]:
        """DISTINCT-only facet rebuild for old packages without filtering_terms.json."""
        terms: Dict[str, Dict[str, Any]] = {}
        needed_resources: Set[str] = set()

        def add_term(
            *,
            type_: str,
            id_: str,
            label: Optional[str],
            scopes: List[str],
            values: Optional[List[str]] = None,
        ) -> None:
            if re.match(r"^(HGNC|NCBIGene|ENSEMBL):", id_, re.I):
                return
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
            scope_set = list(dict.fromkeys((existing.get("scopes") or []) + scopes))
            existing["scopes"] = scope_set
            if label and not existing.get("label"):
                existing["label"] = label
            if values:
                existing["values"] = list(
                    dict.fromkeys((existing.get("values") or []) + values)
                )

        # Biosample facets
        if self._all_biosamples_view:
            rows, _ = self._fetchall(
                f"""
                SELECT DISTINCT CAST(ontology_id AS VARCHAR),
                       CAST(ontology_label AS VARCHAR),
                       CAST(ontology_source AS VARCHAR)
                FROM {self._all_biosamples_view}
                WHERE ontology_id IS NOT NULL
                """
            )
            from beacon.filter_display import is_biosample_catalog_ontology_id

            for oid, olabel, _osrc in rows:
                if not oid:
                    continue
                oid_s = str(oid)
                if not is_biosample_catalog_ontology_id(oid_s):
                    continue
                pref = oid_s.split(":", 1)[0].upper()
                needed_resources.add(pref.lower())
                add_term(
                    type_=pref,
                    id_=oid_s,
                    label=str(olabel) if olabel else None,
                    scopes=["biosample"],
                )

        # Feature SO + resource facets
        feat_src = self._all_features_view
        if feat_src:
            needed_resources.add("so")
            rows, _ = self._fetchall(
                f"""
                SELECT DISTINCT CAST(feature_type_id AS VARCHAR),
                       CAST(feature_type_label AS VARCHAR)
                FROM {feat_src}
                WHERE feature_type_id IS NOT NULL
                """
            )
            for tid, tlabel in rows:
                if tid:
                    add_term(
                        type_="SO",
                        id_=str(tid),
                        label=str(tlabel) if tlabel else None,
                        scopes=["genomicFeature", "matrix"],
                    )
            try:
                rows, _ = self._fetchall(
                    f"""
                    SELECT DISTINCT CAST(term.id AS VARCHAR),
                           CAST(term.label AS VARCHAR)
                    FROM {feat_src}, UNNEST(ontology_terms) AS _ot(term)
                    WHERE ontology_terms IS NOT NULL AND term.id IS NOT NULL
                    """
                )
                for tid, tlabel in rows:
                    if not tid:
                        continue
                    tid_s = str(tid)
                    pref = tid_s.split(":", 1)[0].upper()
                    if pref == "SO":
                        needed_resources.add("so")
                        add_term(
                            type_="SO",
                            id_=tid_s,
                            label=str(tlabel) if tlabel else None,
                            scopes=["genomicFeature", "matrix"],
                        )
                    elif pref == "GO":
                        needed_resources.add("go")
                        add_term(
                            type_="GO",
                            id_=tid_s,
                            label=str(tlabel) if tlabel else None,
                            scopes=["genomicFeature"],
                        )
            except duckdb.Error as exc:
                logger.warning("ontology_terms facet scan failed: %s", exc)
            rows, _ = self._fetchall(
                f"""
                SELECT DISTINCT CAST(resource AS VARCHAR)
                FROM {feat_src}
                WHERE resource IS NOT NULL
                """
            )
            observed_resources = {
                str(resource).strip().lower()
                for (resource,) in rows
                if resource and str(resource).strip()
            }
            from beacon.filters import (
                FEATURE_RESOURCE_CATALOG_VALUES,
                FEATURE_RESOURCE_ID,
                FEATURE_RESOURCE_VALUE_TO_STORED,
            )

            resource_values = [
                label
                for label in FEATURE_RESOURCE_CATALOG_VALUES
                if FEATURE_RESOURCE_VALUE_TO_STORED[label].lower() in observed_resources
            ]
            # Always advertise both GenCode and NCBI Gene when either annotation
            # resource is present (GenCode was previously skipped from catalogs).
            if observed_resources & {"gencode", "ncbigene", "ncbi", "ensembl"}:
                resource_values = list(FEATURE_RESOURCE_CATALOG_VALUES)
            if resource_values:
                add_term(
                    type_="alphanumeric",
                    id_=FEATURE_RESOURCE_ID,
                    label="Annotation resource",
                    scopes=["genomicFeature"],
                    values=resource_values,
                )
            if observed_resources & {"gencode", "ensembl"}:
                needed_resources.add("ensembl")
            if observed_resources & {"ncbigene", "ncbi"}:
                needed_resources.add("ncbigene")
            # Symbol is a lookup namespace (no per-gene term dump).
            needed_resources.add("symbol")

        # Gene-id namespaces from lookup prefixes (no value dump)
        if self._has_gene_lookup:
            try:
                rows, _ = self._fetchall(
                    """
                    SELECT DISTINCT
                      upper(split_part(CAST(lookup_key AS VARCHAR), ':', 1))
                    FROM gene_lookup
                    WHERE lookup_kind = 'xref'
                      AND CAST(lookup_key AS VARCHAR) LIKE '%:%'
                    """
                )
                for (pref,) in rows:
                    p = str(pref or "").upper()
                    if p == "HGNC":
                        needed_resources.add("hgnc")
                    elif p in ("NCBIGENE", "GENEID"):
                        needed_resources.add("ncbigene")
                    elif p in ("ENSEMBL", "ENSG"):
                        needed_resources.add("ensembl")
            except duckdb.Error as exc:
                logger.warning("gene_lookup prefix scan failed: %s", exc)
            try:
                sym_rows, _ = self._fetchall(
                    """
                    SELECT 1 FROM gene_lookup
                    WHERE lookup_kind = 'symbol'
                    LIMIT 1
                    """
                )
                if sym_rows:
                    needed_resources.add("symbol")
            except duckdb.Error as exc:
                logger.debug("gene_lookup symbol presence check skipped: %s", exc)

        # biosample.preset and tissueHigh/Specific stay match-only (not catalogued).
        # tissueTop / tissuePresent are advertised below via package merge.

        filtering_terms = sorted(terms.values(), key=lambda t: (t["id"], t["type"]))
        by_scope: Dict[str, List[str]] = {"biosample": [], "genomicFeature": []}
        for t in filtering_terms:
            for scope in t.get("scopes") or []:
                by_scope.setdefault(scope, []).append(t["id"])
        resource_order = (
            "so",
            "go",
            "obi",
            "uberon",
            "efo",
            "mondo",
            "hp",
            "ncit",
            "hgnc",
            "ncbigene",
            "ensembl",
            "symbol",
        )
        resources = [
            dict(self._FT_RESOURCE_DEFS[rid])
            for rid in resource_order
            if rid in needed_resources and rid in self._FT_RESOURCE_DEFS
        ]
        return {
            "schemaVersion": 1,
            "resources": resources,
            "filteringTerms": filtering_terms,
            "byScope": by_scope,
        }

    def filtering_terms(
        self, *, scopes: Optional[Sequence[str]] = None
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_catalog_seed import merge_filtering_terms
        from beacon.tissue_explore_catalog import tissue_explore_filtering_terms_for_package

        doc = self._filtering_terms_doc or {}
        terms = list(doc.get("filteringTerms") or [])
        resources = list(doc.get("resources") or [])
        # Ensure matrix-scoped facets are present even if filtering_terms.json
        # was built without them (matches FixtureStore behavior).
        matrix_terms, matrix_resources = self.matrix_filtering_terms()
        terms = merge_filtering_terms(terms, matrix_terms)
        # Advertise tissueTop / tissuePresent even when package JSON predates them.
        tissue_terms = tissue_explore_filtering_terms_for_package(self.package_path)
        if tissue_terms:
            terms = merge_filtering_terms(terms, tissue_terms)
        resources_by_id = {
            str(r.get("id") or ""): dict(r)
            for r in (*resources, *matrix_resources)
            if r.get("id")
        }
        resources = list(resources_by_id.values())
        if scopes:
            want = set(scopes)
            terms = [
                t
                for t in terms
                if want.intersection(t.get("scopes") or [])
            ]
            keep_ids = set()
            for t in terms:
                tid = str(t.get("id") or "")
                if ":" in tid:
                    keep_ids.add(tid.split(":", 1)[0].lower())
                typ = str(t.get("type") or "").lower()
                if typ in (
                    "so",
                    "go",
                    "uberon",
                    "efo",
                    "obi",
                    "mondo",
                    "hp",
                    "ncit",
                ):
                    keep_ids.add(typ)
            if "genomicFeature" in want:
                keep_ids.update(
                    {"hgnc", "ncbigene", "ensembl", "so", "go", "symbol"}
                )
            if "biosample" in want:
                keep_ids.update(
                    {"uberon", "efo", "obi", "mondo", "hp", "go", "ncit"}
                )
            if "matrix" in want:
                keep_ids.update({"so", "obi"})
            resources = [
                r
                for r in resources
                if str(r.get("id") or "").lower() in keep_ids
                or str(r.get("nameSpacePrefix") or "").lower() in keep_ids
            ]
        return terms, resources

    def _gene_lookup_exists_sql(
        self, keys: Sequence[str], *, case_sensitive: bool = False
    ) -> Tuple[str, List[Any]]:
        """SQL fragment: feature_id IN (SELECT … FROM gene_lookup WHERE keys).

        ``case_sensitive=True`` matches ``lookup_key`` exactly (symbol filters).
        Default folds via ``lookup_key_norm`` / ``upper(lookup_key)`` (gene CURIEs).
        """
        tokens = [str(k) for k in keys if k]
        if not tokens or not self._has_gene_lookup:
            return "FALSE", []
        if case_sensitive:
            placeholders = ", ".join(["?"] * len(tokens))
            sql = (
                "CAST(feature_id AS VARCHAR) IN ("
                "SELECT DISTINCT CAST(feature_id AS VARCHAR) FROM gene_lookup "
                f"WHERE CAST(lookup_key AS VARCHAR) IN ({placeholders})"
                ")"
            )
            return sql, list(tokens)
        cols = self._view_columns("gene_lookup")
        if "lookup_key_norm" in cols:
            norms = [t.upper() for t in tokens]
            placeholders = ", ".join(["?"] * len(norms))
            sql = (
                "CAST(feature_id AS VARCHAR) IN ("
                "SELECT DISTINCT CAST(feature_id AS VARCHAR) FROM gene_lookup "
                f"WHERE lookup_key_norm IN ({placeholders})"
                ")"
            )
            return sql, norms
        placeholders = ", ".join(["?"] * len(tokens))
        upper_tokens = [t.upper() for t in tokens]
        upper_ph = ", ".join(["?"] * len(upper_tokens))
        sql = (
            "CAST(feature_id AS VARCHAR) IN ("
            "SELECT DISTINCT CAST(feature_id AS VARCHAR) FROM gene_lookup "
            f"WHERE lookup_key IN ({placeholders}) "
            f"OR upper(CAST(lookup_key AS VARCHAR)) IN ({upper_ph})"
            ")"
        )
        return sql, list(tokens) + upper_tokens

    def _feature_filter_sql(
        self, filters: Sequence[Any], *, use_ontology_index: bool = False
    ) -> Tuple[str, List[Any], bool]:
        """Return (AND sql fragment without leading AND, params, empty_forced)."""
        from beacon.filters import (
            biotype_family_from_filter,
            feature_resource_stored_from_filter,
            is_biotype_family_filter,
            is_feature_ontology_filter,
            is_feature_resource_filter,
            is_gene_public_id_filter,
            is_symbol_custom_filter,
            symbol_custom_lookup_key,
        )

        clauses: List[str] = []
        params: List[Any] = []
        for f in filters:
            if is_feature_ontology_filter(f):
                if use_ontology_index and self._feature_ontology_view:
                    clauses.append(
                        "wrapper_id IN ("
                        f"SELECT wrapper_id FROM {self._feature_ontology_view} "
                        "WHERE CAST(ontology_id AS VARCHAR) = ?"
                        ")"
                    )
                    params.append(f.id)
                else:
                    clauses.append(
                        "(CAST(feature_type_id AS VARCHAR) = ? OR "
                        "(ontology_terms IS NOT NULL AND EXISTS ("
                        "SELECT 1 FROM UNNEST(ontology_terms) AS _ot(term) "
                        "WHERE CAST(term.id AS VARCHAR) = ?"
                        ")))"
                    )
                    params.extend([f.id, f.id])
            elif is_biotype_family_filter(f):
                from beacon.biotype_families import so_ids_for_family

                fam = biotype_family_from_filter(f)
                so_ids = sorted(so_ids_for_family(fam or ""))
                if not so_ids:
                    return "FALSE", [], True
                placeholders = ", ".join(["?"] * len(so_ids))
                clauses.append(
                    f"(CAST(feature_type_id AS VARCHAR) IN ({placeholders}) OR "
                    "(ontology_terms IS NOT NULL AND EXISTS ("
                    "SELECT 1 FROM UNNEST(ontology_terms) AS _ot(term) "
                    f"WHERE CAST(term.id AS VARCHAR) IN ({placeholders})"
                    ")))"
                )
                params.extend(so_ids)
                params.extend(so_ids)
            elif is_gene_public_id_filter(f):
                from beacon.filters import gene_public_id_lookup_keys

                keys = gene_public_id_lookup_keys(f.id)
                frag, fparams = self._gene_lookup_exists_sql(keys)
                if frag == "FALSE":
                    return "FALSE", [], True
                clauses.append(frag)
                params.extend(fparams)
            elif is_symbol_custom_filter(f):
                key = symbol_custom_lookup_key(f)
                if not key:
                    return "FALSE", [], True
                frag, fparams = self._gene_lookup_exists_sql(
                    [key], case_sensitive=True
                )
                if frag == "FALSE":
                    return "FALSE", [], True
                clauses.append(frag)
                params.extend(fparams)
            elif is_feature_resource_filter(f):
                resource = feature_resource_stored_from_filter(f)
                if not resource:
                    return "FALSE", [], True
                clauses.append("lower(CAST(resource AS VARCHAR)) = ?")
                params.append(resource.lower())
            else:
                raise ValueError(f"unhandled feature filter: {f.id}")
        if not clauses:
            return "", [], False
        return " AND ".join(clauses), params, False

    def _expression_feature_filter_sql(
        self, filters: Sequence[Any], *, alias: Optional[str] = None
    ) -> Tuple[str, List[Any], bool]:
        """AND fragment for expression.* feature filters against a feat_stats view.

        ``alias`` prefixes stats columns (e.g. ``s`` for a LEFT JOIN); omit it
        for a bare reference to the stats view's own columns (subquery/IN use).
        Returns (sql, params, empty_forced); empty_forced means a malformed
        custom value (e.g. a non-numeric detected bucket) that can never match.
        """

        def _col(name: str) -> str:
            return f"{alias}.{name}" if alias else name

        clauses: List[str] = []
        params: List[Any] = []
        for f in filters:
            if f.kind == "alphanumeric" and f.id in EXPRESSION_FEATURE_ALPHANUMERIC:
                col = {
                    "expression.median": "median",
                    "expression.mean": "mean",
                    "expression.max": "max_value",
                    "expression.percentile": "median_percentile",
                }[f.id]
                op = f.operator or "="
                sql_op = "!=" if op == "!" else op
                try:
                    value = float(f.value)
                except (TypeError, ValueError):
                    return "FALSE", [], True
                clauses.append(f"{_col(col)} {sql_op} ?")
                params.append(value)
            else:
                raise ValueError(f"unhandled expression feature filter: {f.id}")
        if not clauses:
            return "", [], False
        return " AND ".join(clauses), params, False

    def _expression_biosample_filter_sql(
        self, filters: Sequence[Any], *, alias: Optional[str] = None
    ) -> Tuple[str, List[Any], bool]:
        """AND fragment for expression.* biosample filters against a bio_stats view."""

        def _col(name: str) -> str:
            return f"{alias}.{name}" if alias else name

        clauses: List[str] = []
        params: List[Any] = []
        for f in filters:
            if f.kind == "alphanumeric" and f.id in EXPRESSION_BIOSAMPLE_ALPHANUMERIC:
                op = f.operator or "="
                sql_op = "!=" if op == "!" else op
                try:
                    value = float(f.value)
                except (TypeError, ValueError):
                    return "FALSE", [], True
                clauses.append(f"{_col('detected_genes')} {sql_op} ?")
                params.append(value)
            else:
                raise ValueError(f"unhandled expression biosample filter: {f.id}")
        if not clauses:
            return "", [], False
        return " AND ".join(clauses), params, False

    def _expression_feature_match_subquery_sql(
        self, filters: Sequence[Any]
    ) -> Tuple[Optional[str], List[Any]]:
        """UNION ALL subquery (selecting ``wrapper_id``) of features matching
        expression.* filters on ANY ONE of their matrices (same matrix for all
        given filters). Returns (None, []) when nothing can match.
        """
        frag, params, empty = self._expression_feature_filter_sql(filters, alias="s")
        if empty or not frag:
            return None, []
        parts: List[str] = []
        all_params: List[Any] = []
        for mid, stats_view in self._feat_stats_views.items():
            feat_view = self._feat_views.get(mid)
            if not feat_view:
                continue
            parts.append(
                f"SELECT f.wrapper_id AS wrapper_id FROM {feat_view} f "
                f"JOIN {stats_view} s "
                "ON CAST(f.feature_id AS VARCHAR) = CAST(s.feature_id AS VARCHAR) "
                f"WHERE {frag}"
            )
            all_params.extend(params)
        if not parts:
            return None, []
        return " UNION ALL ".join(parts), all_params

    def _expression_biosample_match_subquery_sql(
        self, filters: Sequence[Any]
    ) -> Tuple[Optional[str], List[Any]]:
        """UNION ALL subquery (selecting ``biosample_id``) of biosamples matching
        expression.* filters on ANY ONE of their matrices.
        """
        frag, params, empty = self._expression_biosample_filter_sql(filters, alias="s")
        if empty or not frag:
            return None, []
        parts: List[str] = []
        all_params: List[Any] = []
        for mid, stats_view in self._bio_stats_views.items():
            bio_view = self._bio_views.get(mid)
            if not bio_view:
                continue
            parts.append(
                f"SELECT b.biosample_id AS biosample_id FROM {bio_view} b "
                f"JOIN {stats_view} s "
                "ON CAST(b.biosample_id AS VARCHAR) = CAST(s.biosample_id AS VARCHAR) "
                f"WHERE {frag}"
            )
            all_params.extend(params)
        if not parts:
            return None, []
        return " UNION ALL ".join(parts), all_params

    @staticmethod
    def _split_expression_feature_filters(
        filters: Optional[Sequence[Any]],
    ) -> Tuple[List[Any], List[Any], List[Any]]:
        """Return (other_filters, expression_feature_filters, tissue_feature_filters)."""
        from beacon.filters import is_expression_custom_feature, is_tissue_feature_filter

        other: List[Any] = []
        expr: List[Any] = []
        tissue: List[Any] = []
        for f in filters or []:
            if (f.kind == "alphanumeric" and f.id in EXPRESSION_FEATURE_ALPHANUMERIC) or (
                f.kind == "custom" and is_expression_custom_feature(f)
            ):
                expr.append(f)
            elif f.kind == "custom" and is_tissue_feature_filter(f):
                tissue.append(f)
            else:
                other.append(f)
        return other, expr, tissue

    def _tissue_high_feature_ids_sql(
        self, ontology_id: str, *, matrix_id: Optional[str] = None
    ) -> Tuple[Optional[str], List[Any]]:
        """SQL selecting ``feature_id`` rows high in ``ontology_id`` (per-matrix)."""
        from beacon.tissue_catalog import TISSUE_HIGH_PERCENTILE

        views: List[Tuple[str, str]] = []
        if matrix_id:
            view = self._tissue_stats_views.get(matrix_id)
            if view:
                views.append((matrix_id, view))
        else:
            views = list(self._tissue_stats_views.items())
        if not views:
            return None, []
        parts: List[str] = []
        params: List[Any] = []
        for _mid, view in views:
            parts.append(
                f"SELECT CAST(feature_id AS VARCHAR) AS feature_id FROM {view} "
                "WHERE CAST(ontology_id AS VARCHAR) = ? AND percentile >= ?"
            )
            params.extend([ontology_id, float(TISSUE_HIGH_PERCENTILE)])
        return " UNION ALL ".join(parts), params

    def _tissue_wrapper_ids_sql_for_filter(
        self, filt: Any
    ) -> Tuple[Optional[str], List[Any]]:
        """Select ``wrapper_id`` for one tissueHigh/Specific/Top filter.

        Prefers the package-level summary (level >= 1 / level = 2 / percentile
        >= explore band). Falls back to per-matrix tissue stats when the
        summary is absent.
        """
        from beacon.expression_filter_maps import parse_tissue_feature_filter
        from beacon.tissue_catalog import (
            TISSUE_EXPLORE_BAND_PERCENTILE,
            TISSUE_HIGH_PERCENTILE,
        )

        parsed = parse_tissue_feature_filter(filt.id)
        if parsed is None:
            return None, []
        kind, oid = parsed
        if self._tissue_summary_view:
            if kind == "top":
                return (
                    f"SELECT wrapper_id "
                    f"FROM {self._tissue_summary_view} "
                    f"WHERE ontology_id = ? "
                    f"AND percentile IS NOT NULL AND percentile >= ?",
                    [oid, float(TISSUE_EXPLORE_BAND_PERCENTILE)],
                )
            if kind == "present":
                return (
                    f"SELECT wrapper_id "
                    f"FROM {self._tissue_summary_view} "
                    f"WHERE ontology_id = ?",
                    [oid],
                )
            level_pred = "level >= 1" if kind == "high" else "level = 2"
            return (
                f"SELECT wrapper_id "
                f"FROM {self._tissue_summary_view} "
                f"WHERE ontology_id = ? AND {level_pred}",
                [oid],
            )
        if not self._tissue_stats_views or not self._feat_views:
            return None, []
        if kind == "top":
            # Per-matrix fallback: percentile >= explore band in any matrix.
            parts_top: List[str] = []
            params_top: List[Any] = []
            for mid, view in self._tissue_stats_views.items():
                feat_view = self._feat_views.get(mid)
                if not feat_view:
                    continue
                parts_top.append(
                    f"SELECT CAST(f.wrapper_id AS VARCHAR) AS wrapper_id "
                    f"FROM {feat_view} f "
                    f"WHERE CAST(f.feature_id AS VARCHAR) IN ("
                    f"SELECT CAST(feature_id AS VARCHAR) FROM {view} "
                    f"WHERE CAST(ontology_id AS VARCHAR) = ? AND percentile >= ?"
                    f")"
                )
                params_top.extend([oid, float(TISSUE_EXPLORE_BAND_PERCENTILE)])
            if not parts_top:
                return None, []
            return " UNION ALL ".join(parts_top), params_top
        if kind == "present":
            parts_present: List[str] = []
            params_present: List[Any] = []
            for mid, view in self._tissue_stats_views.items():
                feat_view = self._feat_views.get(mid)
                if not feat_view:
                    continue
                parts_present.append(
                    f"SELECT CAST(f.wrapper_id AS VARCHAR) AS wrapper_id "
                    f"FROM {feat_view} f "
                    f"WHERE CAST(f.feature_id AS VARCHAR) IN ("
                    f"SELECT CAST(feature_id AS VARCHAR) FROM {view} "
                    f"WHERE CAST(ontology_id AS VARCHAR) = ?"
                    f")"
                )
                params_present.append(oid)
            if not parts_present:
                return None, []
            return " UNION ALL ".join(parts_present), params_present
        high_sql, high_params = self._tissue_high_feature_ids_sql(oid)
        if high_sql is None:
            return None, []
        if kind == "specific":
            # Without a summary, specific = high in oid and not high elsewhere
            # in the union of per-matrix stats (all other tissues).
            other_sql = (
                "SELECT CAST(feature_id AS VARCHAR) AS feature_id FROM ("
                + " UNION ALL ".join(
                    f"SELECT CAST(feature_id AS VARCHAR) FROM {view} "
                    "WHERE CAST(ontology_id AS VARCHAR) <> ? AND percentile >= ?"
                    for _mid, view in self._tissue_stats_views.items()
                )
                + ")"
            )
            other_params: List[Any] = []
            for _mid in self._tissue_stats_views:
                other_params.extend([oid, float(TISSUE_HIGH_PERCENTILE)])
            high_sql = (
                f"SELECT feature_id FROM ({high_sql}) AS _th "
                f"WHERE feature_id NOT IN ({other_sql})"
            )
            high_params = high_params + other_params
        parts: List[str] = []
        params: List[Any] = []
        for mid, feat_view in self._feat_views.items():
            if mid not in self._tissue_stats_views:
                continue
            parts.append(
                f"SELECT CAST(f.wrapper_id AS VARCHAR) AS wrapper_id "
                f"FROM {feat_view} f "
                f"WHERE CAST(f.feature_id AS VARCHAR) IN ({high_sql})"
            )
            params.extend(high_params)
        if not parts:
            return None, []
        return " UNION ALL ".join(parts), params

    def _tissue_feature_match_subquery_sql(
        self, filters: Sequence[Any]
    ) -> Tuple[Optional[str], List[Any]]:
        """Subquery selecting ``wrapper_id`` for tissueHigh/Specific filters (AND)."""
        if not filters:
            return None, []
        per_filter: List[Tuple[str, List[Any]]] = []
        for filt in filters:
            sql, params = self._tissue_wrapper_ids_sql_for_filter(filt)
            if sql is None:
                return None, []
            per_filter.append((sql, params))
        sql = per_filter[0][0]
        params_out = list(per_filter[0][1])
        for nxt_sql, nxt_params in per_filter[1:]:
            sql = f"SELECT wrapper_id FROM ({sql}) WHERE wrapper_id IN ({nxt_sql})"
            params_out.extend(nxt_params)
        return sql, params_out

    def _tissue_matrix_feature_predicate_sql(
        self, matrix_id: str, filt: Any
    ) -> Tuple[Optional[str], List[Any]]:
        """SQL fragment restricting feature_id for one tissue filter in a matrix.

        Nested ``tissueSpecific`` means specific within this matrix's tissues
        (not package-wide reference tissues).
        """
        from beacon.expression_filter_maps import parse_tissue_feature_filter
        from beacon.tissue_catalog import TISSUE_HIGH_PERCENTILE

        view = self._tissue_stats_views.get(matrix_id)
        if not view:
            return None, []
        parsed = parse_tissue_feature_filter(filt.id)
        if parsed is None:
            return None, []
        kind, oid = parsed
        if kind == "present":
            return (
                f"CAST(feature_id AS VARCHAR) IN ("
                f"SELECT CAST(feature_id AS VARCHAR) FROM {view} "
                f"WHERE CAST(ontology_id AS VARCHAR) = ?"
                f")",
                [oid],
            )
        if kind == "top":
            from beacon.tissue_catalog import TISSUE_EXPLORE_BAND_PERCENTILE

            return (
                f"CAST(feature_id AS VARCHAR) IN ("
                f"SELECT CAST(feature_id AS VARCHAR) FROM {view} "
                f"WHERE CAST(ontology_id AS VARCHAR) = ? "
                f"AND percentile IS NOT NULL AND percentile >= ?"
                f")",
                [oid, float(TISSUE_EXPLORE_BAND_PERCENTILE)],
            )
        high_sql, high_params = self._tissue_high_feature_ids_sql(
            oid, matrix_id=matrix_id
        )
        if high_sql is None:
            return None, []
        if kind == "high":
            return (
                f"CAST(feature_id AS VARCHAR) IN ({high_sql})",
                high_params,
            )
        # Specific within this matrix: high in oid and not high in any other
        # ontology_id present in this matrix's tissue stats.
        return (
            f"CAST(feature_id AS VARCHAR) IN ({high_sql}) "
            f"AND CAST(feature_id AS VARCHAR) NOT IN ("
            f"SELECT CAST(feature_id AS VARCHAR) FROM {view} "
            f"WHERE CAST(ontology_id AS VARCHAR) <> ? AND percentile >= ?"
            f")",
            high_params + [oid, float(TISSUE_HIGH_PERCENTILE)],
        )

    def _tissue_sort_join(
        self, tissue_filters: Optional[Sequence[Any]]
    ) -> Tuple[str, str, List[Any]]:
        """Return (join_sql, order_sql, params) for tissue-aware feature ordering.

        Caller must alias the feature source as ``v``.
        """
        from beacon.expression_filter_maps import parse_tissue_feature_filter

        if not tissue_filters or not self._tissue_summary_view:
            return "", "ORDER BY v.wrapper_id", []
        parsed = parse_tissue_feature_filter(tissue_filters[0].id)
        if parsed is None:
            return "", "ORDER BY v.wrapper_id", []
        _kind, oid = parsed
        join = (
            f"LEFT JOIN {self._tissue_summary_view} _tsort "
            f"ON CAST(_tsort.wrapper_id AS VARCHAR) = CAST(v.wrapper_id AS VARCHAR) "
            f"AND CAST(_tsort.ontology_id AS VARCHAR) = ?"
        )
        order = (
            "ORDER BY _tsort.percentile DESC NULLS LAST, v.wrapper_id ASC"
        )
        return join, order, [oid]

    @staticmethod
    def _split_expression_biosample_filters(
        filters: Optional[Sequence[Any]],
    ) -> Tuple[List[Any], List[Any]]:
        """Return (other_filters, expression_biosample_filters)."""
        from beacon.filters import is_expression_custom_biosample

        other: List[Any] = []
        expr: List[Any] = []
        for f in filters or []:
            if (f.kind == "alphanumeric" and f.id in EXPRESSION_BIOSAMPLE_ALPHANUMERIC) or (
                f.kind == "custom" and is_expression_custom_biosample(f)
            ):
                expr.append(f)
            else:
                other.append(f)
        return other, expr

    @staticmethod
    def _reject_matrix_only_expression_filters(filters: Optional[Sequence[Any]]) -> None:
        """Raise ValueError if a root-only-invalid continuous expression filter is present."""
        from beacon.filters import is_matrix_only_expression_filter

        for f in filters or []:
            if is_matrix_only_expression_filter(f):
                raise ValueError(
                    f"matrix-only expression filter is not valid at root scope: {f.id}"
                )

    def _attach_feature_matrix_ids(self, rows: List[Dict[str, Any]]) -> None:
        """Fill matrix_ids on feature index rows via feature_matrix (page-scoped)."""
        if not rows or not self._feature_matrix_view:
            return
        wids = [str(r["wrapper_id"]) for r in rows if r.get("wrapper_id")]
        if not wids:
            return
        placeholders = ", ".join(["?"] * len(wids))
        links, _ = self._fetchall(
            f"""
            SELECT wrapper_id, list(matrix_id) AS matrix_ids
            FROM {self._feature_matrix_view}
            WHERE wrapper_id IN ({placeholders})
            GROUP BY wrapper_id
            """,
            wids,
        )
        by_wid = {str(w): list(mids) if mids is not None else [] for w, mids in links}
        for row in rows:
            wid = str(row.get("wrapper_id") or "")
            row["matrix_ids"] = by_wid.get(wid) or []

    def _tissue_summary_predicate(
        self, filt: Any, alias: str = ""
    ) -> Tuple[Optional[str], List[Any]]:
        """Predicate on ``tissue_summary`` for one tissue filter.

        ``alias`` is a table alias (``s``) or empty for an unaliased reference.
        Returns (None, []) when the summary cannot answer this filter.
        """
        from beacon.expression_filter_maps import parse_tissue_feature_filter
        from beacon.tissue_catalog import TISSUE_EXPLORE_BAND_PERCENTILE

        if not self._tissue_summary_view:
            return None, []
        parsed = parse_tissue_feature_filter(getattr(filt, "id", ""))
        if parsed is None:
            return None, []
        kind, oid = parsed
        prefix = f"{alias}." if alias else ""
        # tissue_summary columns are VARCHAR (loaded as table at startup).
        ontology = f"{prefix}ontology_id = ?"
        if kind == "top":
            return (
                f"{ontology} AND {prefix}percentile IS NOT NULL "
                f"AND {prefix}percentile >= ?",
                [oid, float(TISSUE_EXPLORE_BAND_PERCENTILE)],
            )
        if kind == "present":
            return ontology, [oid]
        if kind == "high":
            return f"{ontology} AND {prefix}level >= 1", [oid]
        if kind == "specific":
            return f"{ontology} AND {prefix}level = 2", [oid]
        return None, []

    def _tissue_filters_supported_by_summary(self, filters: Sequence[Any]) -> bool:
        if not filters or not self._tissue_summary_view:
            return False
        for filt in filters:
            sql, _params = self._tissue_summary_predicate(filt)
            if not sql:
                return False
        return True

    def _tissue_summary_id_membership_sql(
        self,
        tissue_filters: Sequence[Any],
        wrapper_ids: Sequence[str],
    ) -> Tuple[Optional[str], List[Any]]:
        """``tissue_summary s`` predicate: page wrapper ids ∩ every tissue filter."""
        if not tissue_filters or not wrapper_ids or not self._tissue_summary_view:
            return None, []
        pred, params = self._tissue_summary_predicate(tissue_filters[0], alias="s")
        if not pred:
            return None, []
        ids = list(wrapper_ids)
        ph = ", ".join(["?"] * len(ids))
        parts = [pred, f"s.wrapper_id IN ({ph})"]
        out_params: List[Any] = list(params) + ids
        view = self._tissue_summary_view
        for filt in tissue_filters[1:]:
            extra, extra_params = self._tissue_summary_predicate(filt)
            if not extra:
                return None, []
            parts.append(
                "s.wrapper_id IN ("
                f"SELECT wrapper_id FROM {view} "
                f"WHERE {extra} AND wrapper_id IN ({ph}))"
            )
            out_params.extend(extra_params)
            out_params.extend(ids)
        return " AND ".join(parts), out_params

    def _non_tissue_feature_constraint(
        self,
        filters: Optional[Sequence[Any]],
        expr_filters: Optional[Sequence[Any]],
        *,
        use_ontology_index: bool,
    ) -> Tuple[str, List[Any], bool]:
        """Feature-side AND fragment, or empty_forced when nothing can match."""
        parts: List[str] = []
        params: List[Any] = []
        if filters:
            frag, fparams, empty = self._feature_filter_sql(
                filters, use_ontology_index=use_ontology_index
            )
            if empty:
                return "", [], True
            if frag:
                parts.append(frag)
                params.extend(fparams)
        if expr_filters:
            sub_sql, sub_params = self._expression_feature_match_subquery_sql(
                expr_filters
            )
            if sub_sql is None:
                return "", [], True
            parts.append(f"CAST(wrapper_id AS VARCHAR) IN ({sub_sql})")
            params.extend(sub_params)
        return " AND ".join(parts), params, False

    def _wrapper_ids_in_feature_source(
        self, view: str, ids: Sequence[str]
    ) -> List[str]:
        ordered = [str(i) for i in ids if i]
        if not ordered:
            return []
        ph = ", ".join(["?"] * len(ordered))
        rows, _ = self._fetchall(
            f"""
            SELECT DISTINCT CAST(wrapper_id AS VARCHAR)
            FROM {view}
            WHERE CAST(wrapper_id AS VARCHAR) IN ({ph})
               OR CAST(feature_id AS VARCHAR) IN ({ph})
            """,
            ordered + ordered,
        )
        return [str(row[0]) for row in rows if row and row[0]]

    def _wrapper_ids_for_feature_id_list(self, feature_id_list: str) -> List[str]:
        """Map a root ``featureIDList`` to wrapper ids without a catalog-wide join."""
        cache_key = feature_id_list.strip()
        cached = self._lru_get(self._feature_id_list_cache, cache_key)
        if cached is not None:
            return list(cached)
        if self._feature_index_view:
            resolved = self._resolve_feature_filter_ids(
                feature_id_list, matrix_id=None
            )
            if not resolved:
                self._lru_put(
                    self._feature_id_list_cache, cache_key, (), _FEATURE_ID_LIST_CACHE_MAX
                )
                return []
            out = self._wrapper_ids_in_feature_source(
                self._feature_index_view, sorted(resolved)
            )
            self._lru_put(
                self._feature_id_list_cache,
                cache_key,
                tuple(out),
                _FEATURE_ID_LIST_CACHE_MAX,
            )
            return out
        tokens = list(_csv_set(feature_id_list))
        if not tokens:
            return []
        ids = set(tokens)
        if self._has_gene_lookup:
            try:
                feature_ids, _matched = self._gene_lookup_hits(tokens, matrix_id=None)
                ids |= feature_ids
            except duckdb.Error as exc:
                logger.warning("gene_lookup resolve failed: %s", exc)
        if not self._all_features_view:
            return []
        return self._wrapper_ids_in_feature_source(self._all_features_view, sorted(ids))

    def _hydrate_wrappers_in_order(
        self, wrapper_ids: Sequence[str]
    ) -> List[Dict[str, Any]]:
        """Feature records for ``wrapper_ids``, in that order."""
        ids = [str(wid) for wid in wrapper_ids if wid]
        if not ids:
            return []
        by_id: Dict[str, Dict[str, Any]] = {}
        missing: List[str] = []
        for wid in ids:
            cached = self._lru_get(self._hydrated_feature_cache, wid)
            if cached is not None:
                by_id[wid] = cached
            else:
                missing.append(wid)
        if missing:
            ph = ", ".join(["?"] * len(missing))
            if self._feature_index_view:
                rows, cols = self._fetchall(
                    f"""
                    SELECT
                      wrapper_id,
                      feature_id,
                      symbol,
                      resource,
                      feature_type_id,
                      feature_type_label,
                      aliases,
                      xrefs,
                      ontology_terms,
                      chrom,
                      "start" AS start,
                      "end" AS end,
                      strand
                    FROM {self._feature_index_view}
                    WHERE CAST(wrapper_id AS VARCHAR) IN ({ph})
                    """,
                    missing,
                )
                out_rows = [dict(zip(cols, tup)) for tup in rows]
                self._attach_feature_matrix_ids(out_rows)
                for row in out_rows:
                    doc = self._hydrate_feature_row(row)
                    wid = str(row.get("wrapper_id") or "")
                    by_id[wid] = doc
                    if wid:
                        self._lru_put(
                            self._hydrated_feature_cache,
                            wid,
                            doc,
                            _HYDRATED_FEATURE_CACHE_MAX,
                        )
            elif self._all_features_view:
                rows, cols = self._fetchall(
                    f"""
                    SELECT
                      wrapper_id,
                      arbitrary(feature_id) AS feature_id,
                      arbitrary(symbol) AS symbol,
                      arbitrary(resource) AS resource,
                      arbitrary(feature_type_id) AS feature_type_id,
                      arbitrary(feature_type_label) AS feature_type_label,
                      arbitrary(aliases) AS aliases,
                      arbitrary(xrefs) AS xrefs,
                      arbitrary(ontology_terms) AS ontology_terms,
                      arbitrary(chrom) AS chrom,
                      arbitrary("start") AS start,
                      arbitrary("end") AS end,
                      arbitrary(strand) AS strand,
                      list(DISTINCT matrix_id) AS matrix_ids
                    FROM {self._all_features_view}
                    WHERE CAST(wrapper_id AS VARCHAR) IN ({ph})
                    GROUP BY wrapper_id
                    """,
                    missing,
                )
                for tup in rows:
                    row = dict(zip(cols, tup))
                    doc = self._hydrate_feature_row(row)
                    wid = str(row.get("wrapper_id") or "")
                    by_id[wid] = doc
                    if wid:
                        self._lru_put(
                            self._hydrated_feature_cache,
                            wid,
                            doc,
                            _HYDRATED_FEATURE_CACHE_MAX,
                        )
        return [by_id[wid] for wid in ids if wid in by_id]

    def _list_features_page_via_tissue_summary(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
        expr_filters: Optional[Sequence[Any]],
        tissue_filters: Sequence[Any],
        feature_id_list: Optional[str],
        timings: Optional[Dict[str, float]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Page features from ``tissue_summary`` instead of sorting ``feature_index``.

        ``featureIDList`` ∩ tissue filters reads only the requested wrapper ids.
        A tissue filter with no id list joins the summary to ``feature_index`` and
        orders that ontology by percentile. The Beacon feature record is unchanged.
        """
        view = self._tissue_summary_view
        if not view or not tissue_filters:
            return [], 0
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        t0 = time.perf_counter()
        use_index = bool(self._feature_index_view)
        constraint, cparams, empty = self._non_tissue_feature_constraint(
            filters,
            expr_filters,
            use_ontology_index=use_index,
        )
        if empty:
            return [], 0

        if feature_id_list:
            wrapper_ids = self._wrapper_ids_for_feature_id_list(feature_id_list)
            if timings is not None:
                timings["resolve"] = (time.perf_counter() - t0) * 1000.0
            if not wrapper_ids:
                return [], 0
            where, params = self._tissue_summary_id_membership_sql(
                tissue_filters, wrapper_ids
            )
            if not where:
                return [], 0
            from_sql = f"FROM {view} s"
        else:
            if not self._feature_index_view:
                return [], 0
            pred, params = self._tissue_summary_predicate(tissue_filters[0], alias="s")
            if not pred:
                return [], 0
            parts = [pred]
            for filt in tissue_filters[1:]:
                extra, extra_params = self._tissue_summary_predicate(filt)
                if not extra:
                    return [], 0
                parts.append(
                    "s.wrapper_id IN ("
                    f"SELECT wrapper_id FROM {view} WHERE {extra})"
                )
                params.extend(extra_params)
            where = " AND ".join(parts)
            from_sql = (
                f"FROM {view} s "
                f"JOIN {self._feature_index_view} v "
                "ON CAST(v.wrapper_id AS VARCHAR) = s.wrapper_id"
            )
            if timings is not None:
                timings["resolve"] = (time.perf_counter() - t0) * 1000.0

        if constraint:
            source = self._feature_index_view or self._all_features_view
            if not source:
                return [], 0
            where = (
                f"{where} AND s.wrapper_id IN ("
                f"SELECT CAST(wrapper_id AS VARCHAR) FROM {source} WHERE {constraint})"
            )
            params.extend(cparams)

        # Probe shortcut: when featureIDList is bound and skip=0, select first;
        # if the page is short, total equals the page length (skip COUNT).
        t_count = time.perf_counter()
        skip_count = bool(feature_id_list) and skip == 0 and limit > 0
        total: Optional[int] = None
        if not skip_count:
            total_row = self._fetchone(
                f"SELECT COUNT(DISTINCT s.wrapper_id) {from_sql} WHERE {where}",
                params,
            )
            total = int(total_row[0]) if total_row else 0
            if timings is not None:
                timings["count"] = (time.perf_counter() - t_count) * 1000.0
            if limit <= 0 or total <= 0:
                return [], total

        t_select = time.perf_counter()
        rows, _cols = self._fetchall(
            f"""
            SELECT s.wrapper_id AS wrapper_id
            {from_sql}
            WHERE {where}
            GROUP BY s.wrapper_id
            ORDER BY MAX(s.percentile) DESC NULLS LAST,
                     s.wrapper_id ASC
            LIMIT ? OFFSET ?
            """,
            list(params) + [limit, skip],
        )
        ordered = [str(row[0]) for row in rows if row and row[0]]
        if timings is not None:
            timings["select"] = (time.perf_counter() - t_select) * 1000.0

        if skip_count:
            if len(ordered) < limit:
                total = len(ordered)
            else:
                # Page filled; fall back to exact distinct count.
                t_count2 = time.perf_counter()
                total_row = self._fetchone(
                    f"SELECT COUNT(DISTINCT s.wrapper_id) {from_sql} WHERE {where}",
                    params,
                )
                total = int(total_row[0]) if total_row else len(ordered)
                if timings is not None:
                    timings["count"] = (time.perf_counter() - t_count2) * 1000.0
            if total <= 0:
                return [], 0

        assert total is not None
        t_hydrate = time.perf_counter()
        docs = self._hydrate_wrappers_in_order(ordered)
        if timings is not None:
            timings["hydrate"] = (time.perf_counter() - t_hydrate) * 1000.0
        return docs, total

    def list_features_page(
        self,
        *,
        skip: int = 0,
        limit: int = 10,
        filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
        timings: Optional[Dict[str, float]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        self._reject_matrix_only_expression_filters(filters)
        other_filters, expr_filters, tissue_filters = (
            self._split_expression_feature_filters(filters)
        )
        if (
            tissue_filters
            and self._tissue_filters_supported_by_summary(tissue_filters)
            and (feature_id_list or self._feature_index_view)
        ):
            return self._list_features_page_via_tissue_summary(
                skip=skip,
                limit=limit,
                filters=other_filters,
                expr_filters=expr_filters,
                tissue_filters=tissue_filters,
                feature_id_list=feature_id_list,
                timings=timings,
            )
        if self._has_feature_indexes and self._feature_index_view:
            return self._list_features_page_indexed(
                skip=skip,
                limit=limit,
                filters=other_filters,
                expr_filters=expr_filters,
                tissue_filters=tissue_filters,
                feature_id_list=feature_id_list,
            )
        return self._list_features_page_union(
            skip=skip,
            limit=limit,
            filters=other_filters,
            expr_filters=expr_filters,
            tissue_filters=tissue_filters,
            feature_id_list=feature_id_list,
        )

    def _root_feature_id_list_clause(
        self, feature_id_list: Optional[str]
    ) -> Tuple[Optional[str], List[Any], bool]:
        """Return (sql_fragment, params, empty_forced) for root featureIDList."""
        if not feature_id_list:
            return None, [], False
        ids = self._resolve_feature_filter_ids(feature_id_list, matrix_id=None)
        if not ids:
            return None, [], True
        sorted_ids = sorted(ids)
        ph = ", ".join(["?"] * len(sorted_ids))
        # Tokens may be wrapper ids or native feature ids.
        sql = (
            f"(CAST(wrapper_id AS VARCHAR) IN ({ph}) "
            f"OR CAST(feature_id AS VARCHAR) IN ({ph}))"
        )
        return sql, list(sorted_ids) + list(sorted_ids), False

    def _list_features_page_indexed(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
        expr_filters: Optional[Sequence[Any]] = None,
        tissue_filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._feature_index_view
        assert view is not None
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_clauses: List[str] = []
        params: List[Any] = []
        id_sql, id_params, id_empty = self._root_feature_id_list_clause(feature_id_list)
        if id_empty:
            return [], 0
        if id_sql:
            where_clauses.append(id_sql)
            params.extend(id_params)
        if filters:
            frag, fparams, empty = self._feature_filter_sql(
                filters, use_ontology_index=True
            )
            if empty:
                return [], 0
            if frag:
                where_clauses.append(frag)
                params.extend(fparams)
        if expr_filters:
            sub_sql, sub_params = self._expression_feature_match_subquery_sql(
                expr_filters
            )
            if sub_sql is None:
                return [], 0
            where_clauses.append(f"wrapper_id IN ({sub_sql})")
            params.extend(sub_params)
        if tissue_filters:
            t_sql, t_params = self._tissue_feature_match_subquery_sql(tissue_filters)
            if t_sql is None:
                return [], 0
            where_clauses.append(f"wrapper_id IN ({t_sql})")
            params.extend(t_params)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        if filters or expr_filters or tissue_filters or feature_id_list:
            one = self._fetchone(
                f"SELECT COUNT(*) FROM {view} {where_sql}",
                params if params else None,
            )
            total = int(one[0]) if one else 0
        else:
            if self._global_feature_count is None:
                one = self._fetchone(f"SELECT COUNT(*) FROM {view}")
                self._global_feature_count = int(one[0]) if one else 0
            total = self._global_feature_count
        if limit <= 0:
            return [], int(total)
        sort_join, sort_order, sort_params = self._tissue_sort_join(tissue_filters)
        # Qualify filter predicates against alias ``v`` when joining for sort.
        where_v = ""
        if where_clauses:
            # Re-bind filters against alias v by wrapping as a subquery when sorting.
            if sort_join:
                where_v = (
                    "WHERE v.wrapper_id IN ("
                    f"SELECT wrapper_id FROM {view} {where_sql}"
                    ")"
                )
                page_params = sort_params + list(params) + [limit, skip]
            else:
                where_v = where_sql
                page_params = list(params) + [limit, skip]
        else:
            page_params = sort_params + [limit, skip]
            where_v = ""
        rows, cols = self._fetchall(
            f"""
            SELECT
              v.wrapper_id,
              v.feature_id,
              v.symbol,
              v.resource,
              v.feature_type_id,
              v.feature_type_label,
              v.aliases,
              v.xrefs,
              v.ontology_terms,
              v.chrom,
              v."start" AS start,
              v."end" AS end,
              v.strand
            FROM {view} v
            {sort_join}
            {where_v}
            {sort_order}
            LIMIT ? OFFSET ?
            """,
            page_params,
        )
        out_rows = [dict(zip(cols, tup)) for tup in rows]
        self._attach_feature_matrix_ids(out_rows)
        docs = [self._hydrate_feature_row(r) for r in out_rows]
        return docs, int(total)

    def _list_features_page_union(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
        expr_filters: Optional[Sequence[Any]] = None,
        tissue_filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._all_features_view
        if not view:
            return [], 0
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_clauses: List[str] = []
        params: List[Any] = []
        id_sql, id_params, id_empty = self._root_feature_id_list_clause(feature_id_list)
        if id_empty:
            return [], 0
        if id_sql:
            where_clauses.append(id_sql)
            params.extend(id_params)
        if filters:
            frag, fparams, empty = self._feature_filter_sql(filters)
            if empty:
                return [], 0
            if frag:
                where_clauses.append(frag)
                params.extend(fparams)
        if expr_filters:
            sub_sql, sub_params = self._expression_feature_match_subquery_sql(
                expr_filters
            )
            if sub_sql is None:
                return [], 0
            where_clauses.append(f"wrapper_id IN ({sub_sql})")
            params.extend(sub_params)
        if tissue_filters:
            t_sql, t_params = self._tissue_feature_match_subquery_sql(tissue_filters)
            if t_sql is None:
                return [], 0
            where_clauses.append(f"wrapper_id IN ({t_sql})")
            params.extend(t_params)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        if filters or expr_filters or tissue_filters or feature_id_list:
            one = self._fetchone(
                f"SELECT COUNT(DISTINCT wrapper_id) FROM {view} {where_sql}",
                params if params else None,
            )
            total = int(one[0]) if one else 0
        else:
            if self._global_feature_count is None:
                one = self._fetchone(
                    f"SELECT COUNT(DISTINCT wrapper_id) FROM {view}"
                )
                self._global_feature_count = int(one[0]) if one else 0
            total = self._global_feature_count
        sort_join, sort_order, sort_params = self._tissue_sort_join(tissue_filters)
        if sort_join:
            rows, cols = self._fetchall(
                f"""
                SELECT
                  v.wrapper_id,
                  v.feature_id,
                  v.symbol,
                  v.resource,
                  v.feature_type_id,
                  v.feature_type_label,
                  v.aliases,
                  v.xrefs,
                  v.ontology_terms,
                  v.chrom,
                  v.start,
                  v.end,
                  v.strand,
                  v.matrix_ids
                FROM (
                  SELECT
                    wrapper_id,
                    arbitrary(feature_id) AS feature_id,
                    arbitrary(symbol) AS symbol,
                    arbitrary(resource) AS resource,
                    arbitrary(feature_type_id) AS feature_type_id,
                    arbitrary(feature_type_label) AS feature_type_label,
                    arbitrary(aliases) AS aliases,
                    arbitrary(xrefs) AS xrefs,
                    arbitrary(ontology_terms) AS ontology_terms,
                    arbitrary(chrom) AS chrom,
                    arbitrary("start") AS start,
                    arbitrary("end") AS end,
                    arbitrary(strand) AS strand,
                    list(DISTINCT matrix_id) AS matrix_ids
                  FROM {view}
                  {where_sql}
                  GROUP BY wrapper_id
                ) v
                {sort_join}
                {sort_order}
                LIMIT ? OFFSET ?
                """,
                list(params) + sort_params + [limit, skip],
            )
        else:
            rows, cols = self._fetchall(
                f"""
                SELECT
                  wrapper_id,
                  arbitrary(feature_id) AS feature_id,
                  arbitrary(symbol) AS symbol,
                  arbitrary(resource) AS resource,
                  arbitrary(feature_type_id) AS feature_type_id,
                  arbitrary(feature_type_label) AS feature_type_label,
                  arbitrary(aliases) AS aliases,
                  arbitrary(xrefs) AS xrefs,
                  arbitrary(ontology_terms) AS ontology_terms,
                  arbitrary(chrom) AS chrom,
                  arbitrary("start") AS start,
                  arbitrary("end") AS end,
                  arbitrary(strand) AS strand,
                  list(DISTINCT matrix_id) AS matrix_ids
                FROM {view}
                {where_sql}
                GROUP BY wrapper_id
                ORDER BY wrapper_id
                LIMIT ? OFFSET ?
                """,
                params + [limit, skip],
            )
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            out.append(self._hydrate_feature_row(row))
        return out, int(total)

    def get_feature(self, feature_id: str) -> Optional[Dict[str, Any]]:
        if self._has_feature_indexes and self._feature_index_view:
            rows, cols = self._fetchall(
                f"""
                SELECT
                  wrapper_id,
                  feature_id,
                  symbol,
                  resource,
                  feature_type_id,
                  feature_type_label,
                  aliases,
                  xrefs,
                  ontology_terms,
                  chrom,
                  "start" AS start,
                  "end" AS end,
                  strand
                FROM {self._feature_index_view}
                WHERE wrapper_id = ? OR feature_id = ?
                LIMIT 1
                """,
                [feature_id, feature_id],
            )
            if not rows:
                return None
            row = dict(zip(cols, rows[0]))
            self._attach_feature_matrix_ids([row])
            doc = self._hydrate_feature_row(row)
            return doc

        view = self._all_features_view
        if not view:
            return None
        rows, cols = self._fetchall(
            f"""
            SELECT
              wrapper_id,
              arbitrary(feature_id) AS feature_id,
              arbitrary(symbol) AS symbol,
              arbitrary(resource) AS resource,
              arbitrary(feature_type_id) AS feature_type_id,
              arbitrary(feature_type_label) AS feature_type_label,
              arbitrary(aliases) AS aliases,
              arbitrary(xrefs) AS xrefs,
              arbitrary(ontology_terms) AS ontology_terms,
              arbitrary(chrom) AS chrom,
              arbitrary("start") AS start,
              arbitrary("end") AS end,
              arbitrary(strand) AS strand,
              list(DISTINCT matrix_id) AS matrix_ids
            FROM {view}
            WHERE wrapper_id = ? OR feature_id = ?
            GROUP BY wrapper_id
            ORDER BY wrapper_id
            LIMIT 1
            """,
            [feature_id, feature_id],
        )
        if not rows:
            return None
        doc = self._hydrate_feature_row(dict(zip(cols, rows[0])))
        return doc

    def _biosample_filter_sql(
        self,
        filters: Sequence[Any],
        *,
        available_cols: Optional[Set[str]] = None,
        matrix_id: Optional[str] = None,
    ) -> Tuple[str, List[Any], bool]:
        """Return (AND sql without leading AND, params, empty_forced) for biosamples."""
        from beacon.filters import is_expression_custom_biosample

        clauses: List[str] = []
        params: List[Any] = []
        cols = available_cols or set()

        def _require_col(col: str) -> bool:
            if not cols:
                return True
            if col not in cols:
                clauses.append("1=0")
                return False
            return True

        for f in filters:
            if f.kind == "alphanumeric" and f.id in ("rin", "ischemic_time_min"):
                col = f.id
                if not _require_col(col):
                    continue
                op = f.operator or "="
                if op not in ("=", "!", ">", "<", ">=", "<="):
                    raise ValueError(f"unsupported {col} operator: {op}")
                if op == "!":
                    clauses.append(
                        f"({col} IS NULL OR CAST({col} AS DOUBLE) != ?)"
                    )
                    params.append(float(f.value))
                else:
                    clauses.append(f"CAST({col} AS DOUBLE) {op} ?")
                    params.append(float(f.value))
            elif (
                f.kind == "alphanumeric" and f.id in EXPRESSION_BIOSAMPLE_ALPHANUMERIC
            ) or (f.kind == "custom" and is_expression_custom_biosample(f)):
                stats_view = self._bio_stats_views.get(matrix_id) if matrix_id else None
                if not stats_view:
                    clauses.append("1=0")
                    continue
                frag, fparams, empty = self._expression_biosample_filter_sql([f])
                if empty or not frag:
                    clauses.append("1=0")
                    continue
                clauses.append(
                    "CAST(biosample_id AS VARCHAR) IN ("
                    f"SELECT CAST(biosample_id AS VARCHAR) FROM {stats_view} WHERE {frag})"
                )
                params.extend(fparams)
            elif f.kind == "ontology":
                or_parts: List[str] = []
                oid = f.id
                for col in (
                    "ontology_id",
                    "sample_origin_type_id",
                    "biosample_status_id",
                    "sample_processing_id",
                ):
                    if not cols or col in cols:
                        or_parts.append(f"CAST({col} AS VARCHAR) = ?")
                        params.append(oid)
                if not cols or "phenotypic_ontology_ids" in cols:
                    or_parts.append("list_contains(phenotypic_ontology_ids, ?)")
                    params.append(oid)
                elif not cols or "phenotype_ids" in cols:
                    or_parts.append("list_contains(phenotype_ids, ?)")
                    params.append(oid)
                if not cols or "measurement_assay_ids" in cols:
                    or_parts.append("list_contains(measurement_assay_ids, ?)")
                    params.append(oid)
                if or_parts:
                    clauses.append("(" + " OR ".join(or_parts) + ")")
                else:
                    clauses.append("1=0")
            else:
                raise ValueError(f"unhandled biosample filter: {f.id}")
        if not clauses:
            return "", [], False
        return " AND ".join(clauses), params, False

    def _hydrate_biosample_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        doc = self._biosample_doc(row)
        bid = doc["id"]
        doc["matrixIds"] = self._biosample_matrices.get(bid) or []
        if not doc["matrixIds"] and row.get("matrix_id"):
            doc["matrixIds"] = [str(row["matrix_id"])]
        return doc

    def list_biosamples_page(
        self,
        *,
        skip: int = 0,
        limit: int = 10,
        filters: Optional[Sequence[Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        self._reject_matrix_only_expression_filters(filters)
        other_filters, expr_filters = self._split_expression_biosample_filters(filters)
        if self._has_biosample_indexes and self._biosamples_global_view:
            return self._list_biosamples_page_indexed(
                skip=skip, limit=limit, filters=other_filters, expr_filters=expr_filters
            )
        return self._list_biosamples_page_union(
            skip=skip, limit=limit, filters=other_filters, expr_filters=expr_filters
        )

    def _list_biosamples_page_indexed(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
        expr_filters: Optional[Sequence[Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._biosamples_global_view
        assert view is not None
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_clauses: List[str] = []
        params: List[Any] = []
        if filters:
            frag, fparams, empty = self._biosample_filter_sql(
                filters, available_cols=self._view_columns(view)
            )
            if empty:
                return [], 0
            if frag:
                where_clauses.append(frag)
                params.extend(fparams)
        if expr_filters:
            sub_sql, sub_params = self._expression_biosample_match_subquery_sql(
                expr_filters
            )
            if sub_sql is None:
                return [], 0
            where_clauses.append(f"biosample_id IN ({sub_sql})")
            params.extend(sub_params)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        if filters or expr_filters or self._global_biosample_count is None:
            one = self._fetchone(
                f"SELECT COUNT(*) FROM {view} {where_sql}",
                params if params else None,
            )
            total = int(one[0]) if one else 0
            if not filters and not expr_filters:
                self._global_biosample_count = total
        else:
            total = self._global_biosample_count
        if limit <= 0:
            return [], int(total)
        sel_cols = self._biosample_hydrate_columns(view)
        if "biosample_id" not in sel_cols:
            sel_cols = ["biosample_id"] + sel_cols
        col_sql = ", ".join(sel_cols)
        rows, cols = self._fetchall(
            f"""
            SELECT {col_sql}
            FROM {view}
            {where_sql}
            ORDER BY biosample_id
            LIMIT ? OFFSET ?
            """,
            params + [limit, skip],
        )
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            out.append(self._hydrate_biosample_row(row))
        return out, int(total)

    def _list_biosamples_page_union(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
        expr_filters: Optional[Sequence[Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._all_biosamples_view
        if not view:
            return [], 0
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_clauses: List[str] = []
        params: List[Any] = []
        if filters:
            frag, fparams, empty = self._biosample_filter_sql(
                filters, available_cols=self._view_columns(view)
            )
            if empty:
                return [], 0
            if frag:
                where_clauses.append(frag)
                params.extend(fparams)
        if expr_filters:
            sub_sql, sub_params = self._expression_biosample_match_subquery_sql(
                expr_filters
            )
            if sub_sql is None:
                return [], 0
            where_clauses.append(f"biosample_id IN ({sub_sql})")
            params.extend(sub_params)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        # Deduplicate by biosample_id across matrices.
        count_sql = f"""
            SELECT COUNT(*) FROM (
              SELECT biosample_id
              FROM {view}
              {where_sql}
              GROUP BY biosample_id
            ) AS _b
        """
        one = self._fetchone(count_sql, params if params else None)
        total = int(one[0]) if one else 0
        union_cols = self._biosample_hydrate_columns(view)
        if "biosample_id" not in union_cols:
            union_cols = ["biosample_id"] + union_cols
        agg_parts = [
            f"arbitrary({c}) AS {c}" if c != "biosample_id" else "biosample_id"
            for c in union_cols
        ]
        agg_sql = ", ".join(agg_parts) + ", list(DISTINCT matrix_id) AS matrix_ids"
        rows, cols = self._fetchall(
            f"""
            SELECT {agg_sql}
            FROM {view}
            {where_sql}
            GROUP BY biosample_id
            ORDER BY biosample_id
            LIMIT ? OFFSET ?
            """,
            params + [limit, skip],
        )
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            # Prefer aggregated matrix_ids from SQL when present
            raw_mids = row.get("matrix_ids")
            if raw_mids is not None and not _is_nan(raw_mids):
                try:
                    mids = [str(x) for x in list(raw_mids)]
                except TypeError:
                    mids = [str(raw_mids)]
                self._biosample_matrices.setdefault(str(row["biosample_id"]), mids)
            out.append(self._hydrate_biosample_row(row))
        return out, total

    def get_biosample(self, biosample_id: str) -> Optional[Dict[str, Any]]:
        if self._has_biosample_indexes and self._biosamples_global_view:
            view = self._biosamples_global_view
            sel_cols = self._biosample_hydrate_columns(view)
            if "biosample_id" not in sel_cols:
                sel_cols = ["biosample_id"] + sel_cols
            col_sql = ", ".join(sel_cols)
            rows, cols = self._fetchall(
                f"""
                SELECT {col_sql}
                FROM {view}
                WHERE biosample_id = ?
                LIMIT 1
                """,
                [biosample_id],
            )
            if not rows:
                return None
            return self._hydrate_biosample_row(dict(zip(cols, rows[0])))

        view = self._all_biosamples_view
        if not view:
            return None
        union_cols = self._biosample_hydrate_columns(view)
        if "biosample_id" not in union_cols:
            union_cols = ["biosample_id"] + union_cols
        agg_parts = [
            f"arbitrary({c}) AS {c}" if c != "biosample_id" else "biosample_id"
            for c in union_cols
        ]
        agg_sql = ", ".join(agg_parts) + ", list(DISTINCT matrix_id) AS matrix_ids"
        rows, cols = self._fetchall(
            f"""
            SELECT {agg_sql}
            FROM {view}
            WHERE biosample_id = ?
            GROUP BY biosample_id
            LIMIT 1
            """,
            [biosample_id],
        )
        if not rows:
            return None
        row = dict(zip(cols, rows[0]))
        raw_mids = row.get("matrix_ids")
        if raw_mids is not None and not _is_nan(raw_mids):
            try:
                mids = [str(x) for x in list(raw_mids)]
            except TypeError:
                mids = [str(raw_mids)]
            self._biosample_matrices[str(row["biosample_id"])] = mids
        return self._hydrate_biosample_row(row)

    def matrices_for_biosample(self, biosample_id: str) -> List[Dict[str, Any]]:
        ids = self._biosample_matrices.get(biosample_id) or []
        return [self._matrices_by_id[i] for i in ids if i in self._matrices_by_id]

    def matrices_for_feature_page(
        self,
        feature_id: str,
        *,
        filters: Optional[Sequence[Any]] = None,
        matrix_id_list: Optional[str] = None,
        skip: int = 0,
        limit: int = 10,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Matrices linked to a feature, optionally filtered by expression.*
        feature filters (evaluated per-matrix against that matrix's stats for
        this feature) and/or matrix-scoped filters (``matrix.*`` / OBI / SO).
        """
        from beacon.filters import (
            feature_doc_matches,
            is_expression_custom_feature,
            is_tissue_feature_filter,
        )
        from beacon.matrix_catalog import matrix_matches

        feature = self.get_feature(feature_id)
        if not feature:
            return [], 0
        matrix_ids = list(feature.get("matrixIds") or [])
        if matrix_id_list:
            wanted = _csv_set(matrix_id_list)
            matrix_ids = [m for m in matrix_ids if m in wanted]
        if len(matrix_ids) > MAX_INTERMEDIATE_IDS:
            raise ValueError(
                f"feature links to more than {MAX_INTERMEDIATE_IDS} matrices; "
                "narrow with matrixIDList"
            )

        native_id = str(
            (feature.get("genomicFeature") or {}).get("featureIdentifier", {}).get("id")
            or feature_id
        )

        expr_filters: List[Any] = []
        tissue_filters: List[Any] = []
        matrix_filters: List[Any] = []
        other_feature_filters: List[Any] = []
        for f in filters or []:
            if (f.kind == "alphanumeric" and f.id in EXPRESSION_FEATURE_ALPHANUMERIC) or (
                f.kind == "custom" and is_expression_custom_feature(f)
            ):
                expr_filters.append(f)
            elif f.kind == "custom" and is_tissue_feature_filter(f):
                tissue_filters.append(f)
            elif f.kind in ("alphanumeric", "ontology") and axis_filter_scope(f) == "matrix":
                matrix_filters.append(f)
            else:
                other_feature_filters.append(f)

        if other_feature_filters and not feature_doc_matches(
            feature, other_feature_filters
        ):
            return [], 0

        kept: List[Dict[str, Any]] = []
        expr_frag: Optional[str] = None
        expr_params: List[Any] = []
        if expr_filters:
            expr_frag, expr_params, empty = self._expression_feature_filter_sql(
                expr_filters
            )
            if empty or not expr_frag:
                return [], 0
        so_matrix = any(
            f.kind == "ontology" and str(f.id).upper().startswith("SO:")
            for f in matrix_filters
        )
        for mid in matrix_ids:
            matrix = self._matrices_by_id.get(mid)
            if not matrix:
                continue
            if matrix_filters:
                extra = self._feature_axis_present_ids(mid) if so_matrix else None
                if not matrix_matches(
                    matrix, matrix_filters, extra_ontology_ids=extra
                ):
                    continue
            if expr_frag is not None:
                stats_view = self._feat_stats_views.get(mid)
                if not stats_view:
                    continue
                row = self._fetchone(
                    f"SELECT 1 FROM {stats_view} "
                    f"WHERE CAST(feature_id AS VARCHAR) = ? AND {expr_frag}",
                    [native_id] + expr_params,
                )
                if not row:
                    continue
            if tissue_filters:
                tissue_ok = True
                for tf in tissue_filters:
                    frag, fparams = self._tissue_matrix_feature_predicate_sql(mid, tf)
                    if frag is None:
                        tissue_ok = False
                        break
                    row = self._fetchone(
                        f"SELECT 1 FROM (SELECT CAST(? AS VARCHAR) AS feature_id) AS _f "
                        f"WHERE {frag}",
                        [native_id] + fparams,
                    )
                    if not row:
                        tissue_ok = False
                        break
                if not tissue_ok:
                    continue
            kept.append(matrix)
        total = len(kept)
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        if limit <= 0:
            return [], total
        return kept[skip : skip + limit], total

    def matrices_for_biosample_page(
        self,
        biosample_id: str,
        *,
        filters: Optional[Sequence[Any]] = None,
        matrix_id_list: Optional[str] = None,
        skip: int = 0,
        limit: int = 10,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Matrices linked to a biosample, optionally filtered by expression.*
        biosample filters (per-matrix) and/or matrix-scoped filters.
        """
        from beacon.filters import biosample_matches, is_expression_custom_biosample
        from beacon.matrix_catalog import matrix_matches

        biosample = self.get_biosample(biosample_id)
        if not biosample:
            return [], 0
        matrix_ids = list(
            biosample.get("matrixIds") or self._biosample_matrices.get(biosample_id) or []
        )
        if matrix_id_list:
            wanted = _csv_set(matrix_id_list)
            matrix_ids = [m for m in matrix_ids if m in wanted]
        if len(matrix_ids) > MAX_INTERMEDIATE_IDS:
            raise ValueError(
                f"biosample links to more than {MAX_INTERMEDIATE_IDS} matrices; "
                "narrow with matrixIDList"
            )

        expr_filters: List[Any] = []
        matrix_filters: List[Any] = []
        other_biosample_filters: List[Any] = []
        for f in filters or []:
            if (f.kind == "alphanumeric" and f.id in EXPRESSION_BIOSAMPLE_ALPHANUMERIC) or (
                f.kind == "custom" and is_expression_custom_biosample(f)
            ):
                expr_filters.append(f)
            elif f.kind in ("alphanumeric", "ontology") and axis_filter_scope(f) == "matrix":
                matrix_filters.append(f)
            else:
                other_biosample_filters.append(f)

        if other_biosample_filters and not biosample_matches(
            biosample, other_biosample_filters
        ):
            return [], 0

        kept: List[Dict[str, Any]] = []
        expr_frag: Optional[str] = None
        expr_params: List[Any] = []
        if expr_filters:
            expr_frag, expr_params, empty = self._expression_biosample_filter_sql(
                expr_filters
            )
            if empty or not expr_frag:
                return [], 0
        so_matrix = any(
            f.kind == "ontology" and str(f.id).upper().startswith("SO:")
            for f in matrix_filters
        )
        for mid in matrix_ids:
            matrix = self._matrices_by_id.get(mid)
            if not matrix:
                continue
            if matrix_filters:
                extra = self._feature_axis_present_ids(mid) if so_matrix else None
                if not matrix_matches(
                    matrix, matrix_filters, extra_ontology_ids=extra
                ):
                    continue
            if expr_frag is not None:
                stats_view = self._bio_stats_views.get(mid)
                if not stats_view:
                    continue
                row = self._fetchone(
                    f"SELECT 1 FROM {stats_view} "
                    f"WHERE CAST(biosample_id AS VARCHAR) = ? AND {expr_frag}",
                    [biosample_id] + expr_params,
                )
                if not row:
                    continue
            kept.append(matrix)
        total = len(kept)
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        if limit <= 0:
            return [], total
        return kept[skip : skip + limit], total

    def effective_axis_sort(
        self,
        matrix_id: str,
        *,
        axis: str,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> Tuple[str, str]:
        """Return the sort/order that will actually be applied for this matrix axis.

        ``axis`` is ``\"features\"`` or ``\"biosamples\"``. Expression sorts degrade
        to ``id`` when the corresponding stats parquet view is missing.
        """
        sort_key, order_key = normalize_axis_sort(sort, order)
        if axis == "biosamples":
            has_stats = bool(self._bio_stats_views.get(matrix_id)) and bool(
                self._bio_views.get(matrix_id)
            )
        else:
            has_stats = bool(self._feat_stats_views.get(matrix_id))
        return degrade_axis_sort_if_no_stats(sort_key, has_stats=has_stats), order_key

    def _matrix_feature_filter_sql(
        self, view: str, filters: Sequence[Any], *, matrix_id: Optional[str] = None
    ) -> Tuple[str, List[Any], bool]:
        """Feature-scoped filters against one matrix ``features`` view.

        Returns (AND fragment without leading AND, params, empty_forced).
        Missing optional columns degrade instead of failing the query.
        """
        from beacon.filters import (
            biotype_family_from_filter,
            feature_resource_stored_from_filter,
            gene_public_id_lookup_keys,
            is_biotype_family_filter,
            is_expression_custom_feature,
            is_feature_ontology_filter,
            is_feature_resource_filter,
            is_gene_public_id_filter,
            is_symbol_custom_filter,
            is_tissue_feature_filter,
            symbol_custom_lookup_key,
        )

        cols = self._view_columns(view)
        clauses: List[str] = []
        params: List[Any] = []
        for filt in filters:
            if (filt.kind == "alphanumeric" and filt.id in EXPRESSION_FEATURE_ALPHANUMERIC) or (
                filt.kind == "custom" and is_expression_custom_feature(filt)
            ):
                stats_view = self._feat_stats_views.get(matrix_id) if matrix_id else None
                if not stats_view:
                    return "FALSE", [], True
                frag, fparams, empty = self._expression_feature_filter_sql([filt])
                if empty or not frag:
                    return "FALSE", [], True
                clauses.append(
                    "CAST(feature_id AS VARCHAR) IN ("
                    f"SELECT CAST(feature_id AS VARCHAR) FROM {stats_view} WHERE {frag})"
                )
                params.extend(fparams)
            elif is_tissue_feature_filter(filt):
                if not matrix_id:
                    return "FALSE", [], True
                frag, fparams = self._tissue_matrix_feature_predicate_sql(
                    matrix_id, filt
                )
                if frag is None:
                    return "FALSE", [], True
                clauses.append(f"({frag})")
                params.extend(fparams)
            elif is_biotype_family_filter(filt):
                from beacon.biotype_families import so_ids_for_family

                fam = biotype_family_from_filter(filt)
                so_ids = sorted(so_ids_for_family(fam or ""))
                if not so_ids:
                    return "FALSE", [], True
                placeholders = ", ".join(["?"] * len(so_ids))
                parts: List[str] = []
                if not cols or "feature_type_id" in cols:
                    parts.append(f"CAST(feature_type_id AS VARCHAR) IN ({placeholders})")
                    params.extend(so_ids)
                if "ontology_terms" in cols:
                    parts.append(
                        "(ontology_terms IS NOT NULL AND EXISTS ("
                        "SELECT 1 FROM UNNEST(ontology_terms) AS _ot(term) "
                        f"WHERE CAST(term.id AS VARCHAR) IN ({placeholders})"
                        "))"
                    )
                    params.extend(so_ids)
                if not parts:
                    return "FALSE", [], True
                clauses.append("(" + " OR ".join(parts) + ")")
            elif is_feature_ontology_filter(filt):
                parts = []
                if not cols or "feature_type_id" in cols:
                    parts.append("CAST(feature_type_id AS VARCHAR) = ?")
                    params.append(filt.id)
                if "ontology_terms" in cols:
                    parts.append(
                        "(ontology_terms IS NOT NULL AND EXISTS ("
                        "SELECT 1 FROM UNNEST(ontology_terms) AS _ot(term) "
                        "WHERE CAST(term.id AS VARCHAR) = ?"
                        "))"
                    )
                    params.append(filt.id)
                if not parts:
                    return "FALSE", [], True
                clauses.append("(" + " OR ".join(parts) + ")")
            elif is_gene_public_id_filter(filt):
                keys = gene_public_id_lookup_keys(filt.id)
                frag, fparams = self._gene_lookup_exists_sql(keys)
                if frag == "FALSE":
                    return "FALSE", [], True
                clauses.append(frag)
                params.extend(fparams)
            elif is_symbol_custom_filter(filt):
                key = symbol_custom_lookup_key(filt)
                if not key:
                    return "FALSE", [], True
                frag, fparams = self._gene_lookup_exists_sql(
                    [key], case_sensitive=True
                )
                if frag == "FALSE":
                    return "FALSE", [], True
                clauses.append(frag)
                params.extend(fparams)
            elif is_feature_resource_filter(filt):
                if cols and "resource" not in cols:
                    return "FALSE", [], True
                resource = feature_resource_stored_from_filter(filt)
                if not resource:
                    return "FALSE", [], True
                clauses.append("lower(CAST(resource AS VARCHAR)) = ?")
                params.append(resource.lower())
            else:
                raise ValueError(f"unhandled feature filter: {filt.id}")
        if not clauses:
            return "", [], False
        return " AND ".join(clauses), params, False

    def _features_page_where(
        self,
        matrix_id: str,
        view: str,
        *,
        feature_filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
        biosample_filters: Optional[Sequence[Any]] = None,
        biosample_id_list: Optional[str] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
    ) -> Tuple[bool, str, List[Any]]:
        """Return (empty, where-without-WHERE, params) for a matrix feature page."""
        clauses: List[str] = []
        params: List[Any] = []
        if feature_filters:
            frag, fparams, empty = self._matrix_feature_filter_sql(
                view, feature_filters, matrix_id=matrix_id
            )
            if empty:
                return True, "", []
            if frag:
                clauses.append(f"({frag})")
                params.extend(fparams)
        if feature_id_list:
            ids = self._resolve_feature_filter_ids(feature_id_list, matrix_id)
            if not ids:
                return True, "", []
            sorted_ids = sorted(ids)
            ph = ", ".join(["?"] * len(sorted_ids))
            id_sql = f"CAST(feature_id AS VARCHAR) IN ({ph})"
            id_params = list(sorted_ids)
            cols = self._view_columns(view)
            if not cols or "wrapper_id" in cols:
                id_sql = (
                    f"({id_sql} OR CAST(wrapper_id AS VARCHAR) IN ({ph}))"
                )
                id_params.extend(sorted_ids)
            clauses.append(id_sql)
            params.extend(id_params)

        expr_needed = bool(
            biosample_filters
            or biosample_id_list
            or min_value is not None
            or max_value is not None
        )
        if expr_needed:
            expr_view = self._expr_views.get(matrix_id)
            if not expr_view:
                return True, "", []
            value_constrained = min_value is not None or max_value is not None
            cohort_requested = bool(biosample_filters or biosample_id_list)
            cohort_sql = ""
            cohort_params: List[Any] = []
            if cohort_requested:
                empty_cohort, cohort_sql, cohort_params = (
                    self._biosample_cohort_predicate(
                        matrix_id,
                        biosample_filters=biosample_filters,
                        biosample_id_list=biosample_id_list,
                    )
                )
                if empty_cohort:
                    return True, "", []
                # Dense matrices store a value for every feature × biosample, so a
                # biosample cohort does not change which features exist.
                if not value_constrained and self._matrix_expression_is_dense(
                    matrix_id
                ):
                    cohort_sql = ""
                    cohort_params = []
            if value_constrained or cohort_sql:
                expr_where = ["1=1"]
                expr_params: List[Any] = []
                if cohort_sql:
                    expr_where.append(
                        f"CAST(biosample_id AS VARCHAR) IN ({cohort_sql})"
                    )
                    expr_params.extend(cohort_params)
                if min_value is not None:
                    expr_where.append("value >= ?")
                    expr_params.append(min_value)
                if max_value is not None:
                    expr_where.append("value <= ?")
                    expr_params.append(max_value)
                clauses.append(
                    "CAST(feature_id AS VARCHAR) IN ("
                    "SELECT DISTINCT CAST(feature_id AS VARCHAR) "
                    f"FROM {expr_view} WHERE {' AND '.join(expr_where)})"
                )
                params.extend(expr_params)
        if not clauses:
            return False, "", []
        return False, " AND ".join(clauses), params

    def features_for_matrix_page(
        self,
        matrix_id: str,
        *,
        skip: int = 0,
        limit: int = 10,
        sort: Optional[str] = None,
        order: Optional[str] = None,
        biosample_filters: Optional[Sequence[Any]] = None,
        feature_filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._feat_views.get(matrix_id)
        if not view:
            return [], 0
        empty, where_sql, where_params = self._features_page_where(
            matrix_id,
            view,
            feature_filters=feature_filters,
            feature_id_list=feature_id_list,
            biosample_filters=biosample_filters,
            biosample_id_list=biosample_id_list,
            min_value=min_value,
            max_value=max_value,
        )
        if empty:
            return [], 0
        if where_sql:
            one = self._fetchone(
                f"SELECT COUNT(*) FROM {view} WHERE {where_sql}",
                where_params,
            )
            total = int(one[0]) if one else 0
        else:
            total = self._feature_counts.get(matrix_id)
            if total is None:
                one = self._fetchone(f"SELECT COUNT(*) FROM {view}")
                total = int(one[0]) if one else 0
                self._feature_counts[matrix_id] = total
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        if limit <= 0:
            return [], int(total)
        sort_key, order_key = self.effective_axis_sort(
            matrix_id, axis="features", sort=sort, order=order
        )
        stats = self._feat_stats_views.get(matrix_id)
        order_sql = "ASC" if order_key == "asc" else "DESC"
        feat_join = (
            "CAST(f.feature_id AS VARCHAR) = CAST(s.feature_id AS VARCHAR)"
        )
        # Constraints stay inside the feature subquery so feature_id is not
        # ambiguous against the expression-stats join.
        feature_from = (
            f"(SELECT * FROM {view} WHERE {where_sql}) f"
            if where_sql
            else f"{view} f"
        )
        page_params = list(where_params) + [limit, skip]
        if sort_key == "expression.max" and stats:
            sql = f"""
                SELECT f.*, s.min_value, s.max_value,
                       s.min_biosample_id, s.max_biosample_id
                FROM {feature_from}
                LEFT JOIN {stats} s ON {feat_join}
                ORDER BY s.max_value {order_sql} NULLS LAST,
                         CAST(f.feature_id AS VARCHAR) ASC
                LIMIT ? OFFSET ?
            """
        elif sort_key == "expression.min" and stats:
            sql = f"""
                SELECT f.*, s.min_value, s.max_value,
                       s.min_biosample_id, s.max_biosample_id
                FROM {feature_from}
                LEFT JOIN {stats} s ON {feat_join}
                ORDER BY s.min_value {order_sql} NULLS LAST,
                         CAST(f.feature_id AS VARCHAR) ASC
                LIMIT ? OFFSET ?
            """
        elif stats:
            sql = f"""
                SELECT f.*, s.min_value, s.max_value,
                       s.min_biosample_id, s.max_biosample_id
                FROM {feature_from}
                LEFT JOIN {stats} s ON {feat_join}
                ORDER BY CAST(f.feature_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        else:
            where_clause = f"WHERE {where_sql}" if where_sql else ""
            sql = f"""
                SELECT * FROM {view}
                {where_clause}
                ORDER BY CAST(feature_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        rows, cols = self._fetchall(sql, page_params)
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            out.append(self._feature_doc_from_row(row, [matrix_id]))
        return out, int(total)

    def _matrix_bio_filter_clause(
        self,
        bio_view: str,
        filters: Optional[Sequence[Any]],
        *,
        matrix_id: Optional[str] = None,
    ) -> Tuple[str, List[Any]]:
        if not filters:
            return "", []
        cols = self._view_columns(bio_view)
        frag, params, _empty = self._biosample_filter_sql(
            filters, available_cols=cols, matrix_id=matrix_id
        )
        if not frag:
            return "", []
        return f" WHERE {frag}", params

    def _biosample_count(self, matrix_id: str) -> int:
        if matrix_id in self._biosample_counts:
            return self._biosample_counts[matrix_id]
        view = self._bio_views.get(matrix_id)
        if not view:
            self._biosample_counts[matrix_id] = 0
            return 0
        one = self._fetchone(f"SELECT COUNT(*) FROM {view}")
        count = int(one[0]) if one else 0
        self._biosample_counts[matrix_id] = count
        return count

    def _matrix_expression_is_dense(self, matrix_id: str) -> bool:
        if matrix_id in self._dense_cache:
            return self._dense_cache[matrix_id]
        total = self._recorded_expression_rows(matrix_id)
        n_feat = int(self._feature_counts.get(matrix_id) or 0)
        n_bio = self._biosample_count(matrix_id)
        dense = bool(
            total is not None and n_feat > 0 and n_bio > 0 and int(total) == n_feat * n_bio
        )
        self._dense_cache[matrix_id] = dense
        return dense

    def _biosample_cohort_predicate(
        self,
        matrix_id: str,
        *,
        biosample_filters: Optional[Sequence[Any]] = None,
        biosample_id_list: Optional[str] = None,
    ) -> Tuple[bool, str, List[Any]]:
        """Return (empty, biosample-id SELECT, params).

        ``empty`` means a cohort was requested and matched nothing.
        The SELECT is empty when there is no biosample constraint.
        """
        if not biosample_filters and not biosample_id_list:
            return False, "", []
        bio_view = self._bio_views.get(matrix_id)
        if not bio_view:
            return True, "", []
        where_sql, where_params = self._matrix_bio_filter_clause(
            bio_view, biosample_filters, matrix_id=matrix_id
        )
        params: List[Any] = list(where_params)
        parts: List[str] = []
        if where_sql.startswith(" WHERE "):
            parts.append(where_sql[len(" WHERE ") :])
        if biosample_id_list:
            ids = sorted(_csv_set(biosample_id_list))
            if not ids:
                return True, "", []
            placeholders = ", ".join(["?"] * len(ids))
            parts.append(f"CAST(biosample_id AS VARCHAR) IN ({placeholders})")
            params.extend(ids)
        predicate = (" WHERE " + " AND ".join(parts)) if parts else ""
        counted = self._fetchone(
            f"SELECT COUNT(*) FROM {bio_view}{predicate}",
            params if params else None,
        )
        matched = int(counted[0]) if counted else 0
        if matched == 0:
            return True, "", []
        # The cohort is every sample in the matrix, so it does not change the rows.
        if matched == self._biosample_count(matrix_id):
            return False, "", []
        sql = f"SELECT CAST(biosample_id AS VARCHAR) FROM {bio_view}{predicate}"
        return False, sql, params

    def _biosamples_page_where(
        self,
        matrix_id: str,
        bio_view: str,
        *,
        filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
    ) -> Tuple[bool, str, List[Any]]:
        """Return (empty, ``WHERE …`` or '', params) for a matrix biosample page."""
        frag, params, _empty = ("", [], False)
        if filters:
            cols = self._view_columns(bio_view)
            frag, params, forced_empty = self._biosample_filter_sql(
                filters, available_cols=cols, matrix_id=matrix_id
            )
            if forced_empty:
                return True, "", []
        clauses: List[str] = []
        where_params: List[Any] = list(params)
        if frag:
            clauses.append(f"({frag})")
        if biosample_id_list:
            ids = sorted(_csv_set(biosample_id_list))
            if not ids:
                return True, "", []
            ph = ", ".join(["?"] * len(ids))
            clauses.append(f"CAST(biosample_id AS VARCHAR) IN ({ph})")
            where_params.extend(ids)
        if feature_id_list:
            feature_ids = sorted(
                self._resolve_feature_filter_ids(feature_id_list, matrix_id)
            )
            if not feature_ids:
                return True, "", []
            expr_view = self._expr_views.get(matrix_id)
            if not expr_view:
                return True, "", []
            ph = ", ".join(["?"] * len(feature_ids))
            clauses.append(
                "CAST(biosample_id AS VARCHAR) IN ("
                "SELECT DISTINCT CAST(biosample_id AS VARCHAR) "
                f"FROM {expr_view} WHERE CAST(feature_id AS VARCHAR) IN ({ph}))"
            )
            where_params.extend(feature_ids)
        if not clauses:
            return False, "", []
        return False, " WHERE " + " AND ".join(clauses), where_params

    def biosamples_for_matrix_page(
        self,
        matrix_id: str,
        *,
        skip: int = 0,
        limit: int = 10,
        sort: Optional[str] = None,
        order: Optional[str] = None,
        filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Paged biosamples for a matrix with optional expression stats sort."""
        bio_view = self._bio_views.get(matrix_id)
        sort_key, order_key = self.effective_axis_sort(
            matrix_id, axis="biosamples", sort=sort, order=order
        )
        if not bio_view:
            # No biosamples.parquet for this matrix — empty page (do not recurse).
            return [], 0

        empty, where_sql, where_params = self._biosamples_page_where(
            matrix_id,
            bio_view,
            filters=filters,
            feature_id_list=feature_id_list,
            biosample_id_list=biosample_id_list,
        )
        if empty:
            return [], 0
        one = self._fetchone(
            f"SELECT COUNT(*) FROM {bio_view}{where_sql}",
            where_params if where_params else None,
        )
        total = int(one[0]) if one else 0
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        if limit <= 0:
            return [], int(total)
        stats = self._bio_stats_views.get(matrix_id)
        order_sql = "ASC" if order_key == "asc" else "DESC"
        # Filter inside a subquery so biosample_id is not ambiguous vs stats.
        bio_from = (
            f"(SELECT * FROM {bio_view}{where_sql}) b"
            if where_sql
            else f"{bio_view} b"
        )
        page_params = (where_params + [limit, skip]) if where_params else [limit, skip]
        if sort_key == "expression.max" and stats:
            sql = f"""
                SELECT b.*, s.min_value, s.max_value,
                       s.min_feature_id, s.max_feature_id
                FROM {bio_from}
                LEFT JOIN {stats} s
                  ON CAST(b.biosample_id AS VARCHAR) = CAST(s.biosample_id AS VARCHAR)
                ORDER BY s.max_value {order_sql} NULLS LAST,
                         CAST(b.biosample_id AS VARCHAR) ASC
                LIMIT ? OFFSET ?
            """
        elif sort_key == "expression.min" and stats:
            sql = f"""
                SELECT b.*, s.min_value, s.max_value,
                       s.min_feature_id, s.max_feature_id
                FROM {bio_from}
                LEFT JOIN {stats} s
                  ON CAST(b.biosample_id AS VARCHAR) = CAST(s.biosample_id AS VARCHAR)
                ORDER BY s.min_value {order_sql} NULLS LAST,
                         CAST(b.biosample_id AS VARCHAR) ASC
                LIMIT ? OFFSET ?
            """
        elif stats:
            sql = f"""
                SELECT b.*, s.min_value, s.max_value,
                       s.min_feature_id, s.max_feature_id
                FROM {bio_from}
                LEFT JOIN {stats} s
                  ON CAST(b.biosample_id AS VARCHAR) = CAST(s.biosample_id AS VARCHAR)
                ORDER BY CAST(b.biosample_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        else:
            sql = f"""
                SELECT * FROM {bio_view}
                {where_sql}
                ORDER BY CAST(biosample_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        rows, cols = self._fetchall(sql, page_params)
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            doc = self._biosample_doc(row)
            bid = doc["id"]
            # Prefer matrix-scoped matrixIds
            doc["matrixIds"] = self._biosample_matrices.get(bid) or [matrix_id]
            out.append(doc)
        return out, int(total)

    def _feature_index_token_hits(
        self, tokens: Sequence[str]
    ) -> Tuple[Set[str], Set[str]]:
        """Return (feature_ids, matched_tokens) from ``feature_index``.

        A token matches when it equals ``wrapper_id`` or ``feature_id``. Only
        native ``feature_id`` values are added, matching the previous
        ``all_features`` resolve. The original token stays in the caller's set.
        """
        token_list = [str(t) for t in tokens if t]
        if not token_list or not self._feature_index_view:
            return set(), set()
        ph = ", ".join(["?"] * len(token_list))
        rows, _ = self._fetchall(
            f"""
            SELECT DISTINCT
              CAST(wrapper_id AS VARCHAR),
              CAST(feature_id AS VARCHAR)
            FROM {self._feature_index_view}
            WHERE CAST(wrapper_id AS VARCHAR) IN ({ph})
               OR CAST(feature_id AS VARCHAR) IN ({ph})
            """,
            token_list + token_list,
        )
        token_set = set(token_list)
        feature_ids: Set[str] = set()
        matched: Set[str] = set()
        for wid, fid in rows:
            wid_s = str(wid) if wid else ""
            fid_s = str(fid) if fid else ""
            if fid_s:
                feature_ids.add(fid_s)
            if wid_s in token_set:
                matched.add(wid_s)
            if fid_s in token_set:
                matched.add(fid_s)
        return feature_ids, matched

    def _gene_lookup_hits(
        self, tokens: Sequence[str], matrix_id: Optional[str]
    ) -> Tuple[Set[str], Set[str]]:
        """Return (feature_ids, matched_tokens) from ``gene_lookup``."""
        token_list = [str(t) for t in tokens if t]
        if not token_list or not self._has_gene_lookup:
            return set(), set()
        lookup_cols = self._view_columns("gene_lookup")
        if "lookup_key_norm" in lookup_cols:
            norms = [t.upper() for t in token_list]
            ph = ", ".join(["?"] * len(norms))
            q = f"""
            SELECT DISTINCT
              CAST(feature_id AS VARCHAR),
              CAST(lookup_key_norm AS VARCHAR)
            FROM gene_lookup
            WHERE lookup_key_norm IN ({ph})
            """
            params: List[Any] = list(norms)
            key_is_norm = True
        else:
            ph = ", ".join(["?"] * len(token_list))
            upper_tokens = [t.upper() for t in token_list]
            upper_ph = ", ".join(["?"] * len(upper_tokens))
            q = f"""
            SELECT DISTINCT
              CAST(feature_id AS VARCHAR),
              CAST(lookup_key AS VARCHAR)
            FROM gene_lookup
            WHERE (lookup_key IN ({ph})
               OR upper(lookup_key) IN ({upper_ph}))
            """
            params = list(token_list) + upper_tokens
            key_is_norm = False
        if matrix_id:
            mat = self._matrices_by_id.get(matrix_id) or {}
            ann = mat.get("annotation") or {}
            src = ann.get("source")
            ver = str(ann.get("version") or "")
            if src and ver:
                q += " AND annotation_source = ? AND annotation_version = ?"
                params.extend([src, ver])
        rows, _ = self._fetchall(q, params)
        token_set = set(token_list)
        by_upper: Dict[str, List[str]] = {}
        for token in token_list:
            by_upper.setdefault(token.upper(), []).append(token)
        feature_ids: Set[str] = set()
        matched: Set[str] = set()
        for fid, key in rows:
            if not fid:
                continue
            feature_ids.add(str(fid))
            key_s = str(key) if key is not None else ""
            if key_is_norm:
                matched.update(by_upper.get(key_s, []))
            else:
                if key_s in token_set:
                    matched.add(key_s)
                matched.update(by_upper.get(key_s.upper(), []))
        return feature_ids, matched

    def _accumulate_all_features_ids(
        self,
        tokens: Sequence[str],
        resolved: Set[str],
        matrix_id: Optional[str],
    ) -> None:
        """Add native feature ids from ``all_features`` for ``tokens`` only."""
        token_list = [str(t) for t in tokens if t]
        view = self._all_features_view
        if not token_list or not view:
            return
        ph = ", ".join(["?"] * len(token_list))
        q = f"""
        SELECT DISTINCT feature_id
        FROM {view}
        WHERE (wrapper_id IN ({ph})
           OR feature_id IN ({ph}))
        """
        params: List[Any] = list(token_list) + list(token_list)
        if matrix_id:
            q += " AND matrix_id = ?"
            params.append(matrix_id)
        rows, _ = self._fetchall(q, params)
        for (fid,) in rows:
            if fid:
                resolved.add(str(fid))

    def _resolve_feature_filter_ids(
        self, feature_id_list: Optional[str], matrix_id: Optional[str] = None
    ) -> Set[str]:
        tokens = _csv_set(feature_id_list)
        if not tokens:
            return set()
        resolved: Set[str] = set(tokens)

        # Expression-value lookups pass matrix_id and keep the per-matrix scan.
        if matrix_id is not None:
            try:
                self._accumulate_all_features_ids(list(tokens), resolved, matrix_id)
            except duckdb.Error as exc:
                logger.warning("all_features id resolve failed: %s", exc)
            try:
                feature_ids, _matched = self._gene_lookup_hits(list(tokens), matrix_id)
                resolved |= feature_ids
            except duckdb.Error as exc:
                logger.warning("gene_lookup resolve failed: %s", exc)
            return resolved

        unmatched = set(tokens)
        if self._feature_index_view:
            try:
                feature_ids, matched = self._feature_index_token_hits(list(unmatched))
                resolved |= feature_ids
                unmatched -= matched
            except duckdb.Error as exc:
                logger.warning("feature_index id resolve failed: %s", exc)
        if not unmatched:
            return resolved
        if self._has_gene_lookup:
            try:
                feature_ids, matched = self._gene_lookup_hits(list(unmatched), None)
                resolved |= feature_ids
                unmatched -= matched
            except duckdb.Error as exc:
                logger.warning("gene_lookup resolve failed: %s", exc)
        if not unmatched:
            return resolved
        try:
            self._accumulate_all_features_ids(list(unmatched), resolved, None)
        except duckdb.Error as exc:
            logger.warning("all_features id resolve failed: %s", exc)
        return resolved

    @staticmethod
    def _expression_values_order_by(*, value_asc: bool, ties_asc: bool) -> str:
        """Build ORDER BY for expression_values.

        Display order is always
        ``value {asc|desc} NULLS LAST, feature_id ASC, biosample_id ASC``.
        Reverse (previousPage) fetches invert *both* the value direction and
        the tie-breakers so LIMIT returns the prior page under ties.
        """
        value_sql = "ASC" if value_asc else "DESC"
        tie_sql = "ASC" if ties_asc else "DESC"
        return (
            f"value {value_sql} NULLS LAST, "
            f"CAST(feature_id AS VARCHAR) {tie_sql}, "
            f"CAST(biosample_id AS VARCHAR) {tie_sql}"
        )

    def expression_values_for_matrix(
        self,
        matrix_id: str,
        *,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
        biosample_filters: Optional[Sequence[Any]] = None,
        feature_filters: Optional[Sequence[Any]] = None,
        expression_value_filters: Optional[Sequence[Any]] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        order: Optional[str] = None,
        skip: int = 0,
        limit: Optional[int] = None,
        page_token: Optional[str] = None,
    ) -> ExpressionValuesPage:
        """Return a page of expression cells with filters pushed into DuckDB.

        Results are ordered by cell value (``order`` controls direction). No
        caps are applied based on ID-list shape and there is no combined-rank
        ordering: both are intersections / independent AND filters now.
        ``page_token`` (opaque, from a previous response's
        ``nextPage``/``previousPage``) takes precedence over ``skip`` for
        keyset pagination.
        """
        view = self._expr_views.get(matrix_id)
        if not view:
            return ExpressionValuesPage([], 0)

        feature_ids = self._resolve_feature_filter_ids(feature_id_list, matrix_id)
        # Push feature filters into SQL as a subquery so broad matches (e.g.
        # expression.percentile) never materialise a huge Python id set.
        feature_filter_sql = ""
        feature_filter_params: List[Any] = []
        if feature_filters:
            f_view = self._feat_views.get(matrix_id)
            if not f_view:
                return ExpressionValuesPage([], 0)
            frag, fparams, empty = self._matrix_feature_filter_sql(
                f_view, feature_filters, matrix_id=matrix_id
            )
            if empty:
                return ExpressionValuesPage([], 0)
            if frag:
                feature_filter_sql = (
                    "SELECT DISTINCT CAST(feature_id AS VARCHAR) FROM "
                    f"{f_view} WHERE {frag}"
                )
                feature_filter_params = list(fparams)

        cohort_requested = bool(biosample_filters or biosample_id_list)
        cohort_sql = ""
        cohort_params: List[Any] = []
        if cohort_requested:
            empty_cohort, cohort_sql, cohort_params = self._biosample_cohort_predicate(
                matrix_id,
                biosample_filters=biosample_filters,
                biosample_id_list=biosample_id_list,
            )
            if empty_cohort:
                return ExpressionValuesPage([], 0)

        where = ["1=1"]
        params: List[Any] = []
        if feature_ids:
            if len(feature_ids) > MAX_INTERMEDIATE_IDS:
                raise ValueError(
                    f"featureIDList resolves to more than {MAX_INTERMEDIATE_IDS} "
                    "features; narrow the list"
                )
            placeholders = ", ".join(["?"] * len(feature_ids))
            where.append(f"CAST(feature_id AS VARCHAR) IN ({placeholders})")
            params.extend(sorted(feature_ids))
        if feature_filter_sql:
            where.append(
                f"CAST(feature_id AS VARCHAR) IN ({feature_filter_sql})"
            )
            params.extend(feature_filter_params)
        if cohort_sql:
            where.append(f"CAST(biosample_id AS VARCHAR) IN ({cohort_sql})")
            params.extend(cohort_params)
        if min_value is not None:
            where.append("value >= ?")
            params.append(float(min_value))
        if max_value is not None:
            where.append("value <= ?")
            params.append(float(max_value))

        for f in expression_value_filters or []:
            if f.id == "expression.value":
                op = f.operator or "="
                sql_op = "!=" if op == "!" else op
                try:
                    v = float(f.value)
                except (TypeError, ValueError):
                    raise ValueError("expression.value requires a numeric value")
                where.append(f"value {sql_op} ?")
                params.append(v)
            elif f.id in ("expression.percentileInFeature", "expression.percentileInBiosample"):
                pct_views = (
                    self._pct_feat_views
                    if f.id == "expression.percentileInFeature"
                    else self._pct_bio_views
                )
                pct_view = pct_views.get(matrix_id)
                if not pct_view:
                    # Percentile files are optional (fetch-time only) — no file
                    # means no cells can satisfy a percentile filter.
                    return ExpressionValuesPage([], 0)
                op = f.operator or "="
                sql_op = "!=" if op == "!" else op
                try:
                    v = float(f.value)
                except (TypeError, ValueError):
                    raise ValueError(f"{f.id} requires a numeric value")
                where.append(
                    "(CAST(feature_id AS VARCHAR), CAST(biosample_id AS VARCHAR)) IN ("
                    "SELECT CAST(feature_id AS VARCHAR), CAST(biosample_id AS VARCHAR) "
                    f"FROM {pct_view} WHERE pct {sql_op} ?)"
                )
                params.append(v)
            else:
                raise ValueError(f"unhandled expression value filter: {f.id}")

        where_sql = " AND ".join(where)
        order_key = normalize_expression_value_order(order)
        display_asc = order_key == "asc"

        filter_hash = compute_filter_hash(
            matrix_id,
            sorted(feature_ids) if feature_ids else None,
            cohort_sql,
            cohort_params,
            min_value,
            max_value,
            [(f.id, f.operator, f.value) for f in (expression_value_filters or [])]
            + [
                (f.id, f.operator, f.value)
                for f in (feature_filters or [])
            ],
            "value",
            order_key,
        )

        token_payload = decode_page_token(page_token)
        if token_payload is not None and token_payload.get("fh") != filter_hash:
            raise ValueError(
                "pageToken does not match the current filters/sort; "
                "re-issue the request without a page token"
            )

        forward = token_payload is None or token_payload.get("dir") != "prev"
        # Display order keeps ASC ties; reverse fetch inverts value direction
        # *and* ties so LIMIT walks the prior page correctly.
        value_asc = display_asc if forward else (not display_asc)
        ties_asc = forward
        value_cmp = ">" if value_asc else "<"
        tie_cmp = ">" if ties_asc else "<"

        keyset_sql = ""
        keyset_params: List[Any] = []
        if token_payload is not None:
            tf = token_payload.get("f")
            tb = token_payload.get("b")
            tv = token_payload.get("v")
            if tv is None:
                keyset_sql = (
                    "(value IS NULL AND "
                    "(CAST(feature_id AS VARCHAR), CAST(biosample_id AS VARCHAR)) "
                    f"{tie_cmp} (?, ?))"
                )
                keyset_params = [tf, tb]
            else:
                # NULLS LAST: only include the null tail when walking
                # forward. Previous-page reverse fetch must not jump to
                # nulls ahead of earlier non-null rows.
                null_tail = " OR value IS NULL" if forward else ""
                keyset_sql = (
                    f"(value {value_cmp} ? OR (value = ? AND "
                    "(CAST(feature_id AS VARCHAR), CAST(biosample_id AS VARCHAR)) "
                    f"{tie_cmp} (?, ?)){null_tail})"
                )
                keyset_params = [tv, tv, tf, tb]

        limit = MAX_PAGE_LIMIT if limit is None else max(0, min(int(limit), MAX_PAGE_LIMIT))

        one = self._fetchone(f"SELECT COUNT(*) FROM {view} WHERE {where_sql}", params)
        total = int(one[0]) if one else 0

        if limit <= 0:
            return ExpressionValuesPage([], total)

        fetch_where_sql = where_sql
        fetch_params = list(params)
        if keyset_sql:
            fetch_where_sql = f"{where_sql} AND {keyset_sql}"
            fetch_params = fetch_params + keyset_params

        skip_v = 0 if token_payload is not None else max(0, min(int(skip), MAX_SKIP))
        order_by_sql = self._expression_values_order_by(
            value_asc=value_asc, ties_asc=ties_asc
        )
        page_sql = f"""
            SELECT CAST(feature_id AS VARCHAR), CAST(biosample_id AS VARCHAR), value
            FROM {view}
            WHERE {fetch_where_sql}
            ORDER BY {order_by_sql}
            LIMIT ? OFFSET ?
        """
        raw_rows, _ = self._fetchall(page_sql, fetch_params + [limit + 1, skip_v])
        has_extra = len(raw_rows) > limit
        raw_rows = raw_rows[:limit]
        if not forward:
            raw_rows = list(reversed(raw_rows))

        results: List[Dict[str, Any]] = []
        for feature_id, biosample_id, value in raw_rows:
            fid = str(feature_id)
            bid = str(biosample_id)
            results.append(
                {
                    "id": f"{matrix_id}:{fid}:{bid}",
                    "matrixId": matrix_id,
                    "featureId": fid,
                    "biosampleId": bid,
                    "value": float(value) if value is not None else None,
                }
            )

        def _token_for(row: Dict[str, Any], direction: str) -> str:
            return encode_page_token(
                {
                    "f": row["featureId"],
                    "b": row["biosampleId"],
                    "v": row["value"],
                    "dir": direction,
                    "ord": order_key,
                    "sort": "value",
                    "fh": filter_hash,
                }
            )

        next_page: Optional[str] = None
        previous_page: Optional[str] = None
        if results:
            if forward:
                if has_extra:
                    next_page = _token_for(results[-1], "next")
                if token_payload is not None:
                    previous_page = _token_for(results[0], "prev")
            else:
                if has_extra:
                    previous_page = _token_for(results[0], "prev")
                next_page = _token_for(results[-1], "next")

        return ExpressionValuesPage(results, total, next_page, previous_page)
