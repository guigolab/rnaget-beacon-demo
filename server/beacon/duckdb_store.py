"""DuckDB-backed Beacon store over a Parquet data package."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import duckdb

logger = logging.getLogger(__name__)

# Cap page size for expression / feature list endpoints (also enforced in deps).
MAX_PAGE_LIMIT = 1000
MAX_SKIP = 100_000
MAX_ID_LIST_TOKENS = 200

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


def degrade_axis_sort_if_no_stats(
    sort_key: str, *, has_stats: bool
) -> str:
    """Fall back to id sort when expression.* is requested but stats are missing."""
    if sort_key.startswith("expression.") and not has_stats:
        return "id"
    return sort_key


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

        self._biosample_matrices: Dict[str, List[str]] = {}
        self._filtering_terms_doc: Optional[Dict[str, Any]] = None
        self._register_views()
        self._load_indexes()
        self._load_filtering_terms()

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
        return cls._with_expression_summary(doc, row, kind="feature")

    @staticmethod
    def _with_expression_summary(
        doc: Dict[str, Any], row: Dict[str, Any], *, kind: str
    ) -> Dict[str, Any]:
        """Attach info.expressionSummary when stats columns are present on the row."""
        min_v = row.get("min_value")
        max_v = row.get("max_value")
        if min_v is None and max_v is None:
            return doc
        if min_v is not None and _is_nan(min_v):
            min_v = None
        if max_v is not None and _is_nan(max_v):
            max_v = None
        if min_v is None and max_v is None:
            return doc
        summary: Dict[str, Any] = {}
        if min_v is not None:
            summary["min"] = float(min_v)
        if max_v is not None:
            summary["max"] = float(max_v)
        if kind == "feature":
            for src, dst in (
                ("min_biosample_id", "minBiosampleId"),
                ("max_biosample_id", "maxBiosampleId"),
            ):
                val = row.get(src)
                if val is not None and not _is_nan(val):
                    summary[dst] = str(val)
        else:
            for src, dst in (
                ("min_feature_id", "minFeatureId"),
                ("max_feature_id", "maxFeatureId"),
            ):
                val = row.get(src)
                if val is not None and not _is_nan(val):
                    summary[dst] = str(val)
        info = dict(doc.get("info") or {})
        info["expressionSummary"] = summary
        doc["info"] = info
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
        info: Dict[str, Any] = {}
        for key in (
            "sex",
            "lab",
            "age_bracket",
            "condition",
            "timepoint",
            "rin",
            "ischemic_time_min",
        ):
            val = row.get(key)
            if val is not None and not _is_nan(val):
                info[key] = val
        if info:
            doc["info"] = info
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
        from beacon.matrix_catalog import list_matrices_filtered

        return list_matrices_filtered(self.matrices, filters)

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
    ) -> Tuple[Set[str], Dict[str, Set[str]]]:
        view = self._bio_views.get(matrix_id)
        present: Set[str] = set()
        alphanumeric: Dict[str, Set[str]] = {}
        if not view:
            return present, alphanumeric
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
        for col in ("sex", "condition", "age_bracket", "timepoint"):
            if col not in cols:
                continue
            values = self._distinct_values(
                f"SELECT DISTINCT CAST({col} AS VARCHAR) FROM {view} "
                f"WHERE {col} IS NOT NULL"
            )
            if values:
                alphanumeric[col] = values
        return present, alphanumeric

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
        if axis == "features":
            present = self._feature_axis_present_ids(matrix_id)
            present |= _matrix_feature_type_ids(self.get_matrix(matrix_id))
            result = _subset_terms(
                global_terms,
                global_resources,
                present_ids=present,
                alphanumeric={},
                scope="genomicFeature",
                keep_symbol_term=bool(self._feature_counts.get(matrix_id)),
            )
        else:
            present, alphanumeric = self._biosample_axis_facets(matrix_id)
            result = _subset_terms(
                global_terms,
                global_resources,
                present_ids=present,
                alphanumeric=alphanumeric,
                scope="biosample",
                keep_symbol_term=False,
            )
        self._axis_terms_cache[(matrix_id, axis)] = result
        return result

    def get_matrix(self, matrix_id: str) -> Optional[Dict[str, Any]]:
        return self._matrices_by_id.get(matrix_id)

    def list_features(self) -> List[Dict[str, Any]]:
        """Legacy helper — returns at most MAX_PAGE_LIMIT rows; use list_features_page."""
        page, _ = self.list_features_page(skip=0, limit=MAX_PAGE_LIMIT)
        return page

    _FT_RESOURCE_DEFS: Dict[str, Dict[str, str]] = {
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
            for oid, olabel, _osrc in rows:
                if not oid:
                    continue
                pref = str(oid).split(":", 1)[0].upper()
                if pref not in ("UBERON", "EFO"):
                    continue
                needed_resources.add(pref.lower())
                add_term(
                    type_=pref,
                    id_=str(oid),
                    label=str(olabel) if olabel else None,
                    scopes=["biosample"],
                )
            sex_rows, _ = self._fetchall(
                f"""
                SELECT DISTINCT CAST(sex AS VARCHAR)
                FROM {self._all_biosamples_view}
                WHERE sex IS NOT NULL
                """
            )
            sexes = [str(s[0]) for s in sex_rows if s and s[0] is not None]
            if sexes:
                add_term(
                    type_="alphanumeric",
                    id_="sex",
                    label="Sex",
                    scopes=["biosample"],
                    values=sorted(sexes),
                )
            for col, label in (
                ("age_bracket", "Age bracket"),
                ("condition", "Condition / treatment"),
                ("timepoint", "Timepoint"),
            ):
                try:
                    facet_rows, _ = self._fetchall(
                        f"""
                        SELECT DISTINCT CAST({col} AS VARCHAR)
                        FROM {self._all_biosamples_view}
                        WHERE {col} IS NOT NULL
                        """
                    )
                except duckdb.Error as exc:
                    logger.debug("biosample facet %s skipped: %s", col, exc)
                    continue
                values = sorted(
                    {
                        str(row[0])
                        for row in facet_rows
                        if row and row[0] is not None and str(row[0]).strip()
                    }
                )
                if values:
                    add_term(
                        type_="alphanumeric",
                        id_=col,
                        label=label,
                        scopes=["biosample"],
                        values=values,
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
                        scopes=["genomicFeature"],
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
                    if tid and str(tid).upper().startswith("SO:"):
                        add_term(
                            type_="SO",
                            id_=str(tid),
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
            for (resource,) in rows:
                if not resource:
                    continue
                if str(resource).lower() != "gencode":
                    add_term(
                        type_="custom",
                        id_=f"resource:{resource}",
                        label=f"Annotation resource {resource}",
                        scopes=["genomicFeature"],
                    )
                if str(resource).lower() in ("gencode", "ensembl"):
                    needed_resources.add("ensembl")
                if str(resource).lower() in ("ncbigene", "ncbi"):
                    needed_resources.add("ncbigene")
            add_term(
                type_="alphanumeric",
                id_="genomicFeature.symbol",
                label="Gene symbol",
                scopes=["genomicFeature"],
            )

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

        filtering_terms = sorted(terms.values(), key=lambda t: (t["id"], t["type"]))
        by_scope: Dict[str, List[str]] = {"biosample": [], "genomicFeature": []}
        for t in filtering_terms:
            for scope in t.get("scopes") or []:
                by_scope.setdefault(scope, []).append(t["id"])
        resources = [
            dict(self._FT_RESOURCE_DEFS[rid])
            for rid in ("so", "uberon", "efo", "hgnc", "ncbigene", "ensembl")
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
        doc = self._filtering_terms_doc or {}
        terms = list(doc.get("filteringTerms") or [])
        resources = list(doc.get("resources") or [])
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
                if typ in ("so", "uberon", "efo"):
                    keep_ids.add(typ)
            if "genomicFeature" in want:
                keep_ids.update({"hgnc", "ncbigene", "ensembl", "so"})
            if "biosample" in want:
                keep_ids.update({"uberon", "efo"})
            resources = [
                r
                for r in resources
                if str(r.get("id") or "").lower() in keep_ids
                or str(r.get("nameSpacePrefix") or "").lower() in keep_ids
            ]
        return terms, resources

    def _gene_lookup_exists_sql(
        self, keys: Sequence[str]
    ) -> Tuple[str, List[Any]]:
        """SQL fragment: feature_id IN (SELECT … FROM gene_lookup WHERE keys)."""
        tokens = [str(k) for k in keys if k]
        if not tokens or not self._has_gene_lookup:
            return "FALSE", []
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
            is_feature_ontology_filter,
            is_gene_public_id_filter,
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
            elif is_gene_public_id_filter(f):
                from beacon.filters import gene_public_id_lookup_keys

                keys = gene_public_id_lookup_keys(f.id)
                frag, fparams = self._gene_lookup_exists_sql(keys)
                if frag == "FALSE":
                    return "FALSE", [], True
                clauses.append(frag)
                params.extend(fparams)
            elif f.kind == "alphanumeric" and f.id == "genomicFeature.symbol":
                keys = [f.value or ""]
                frag, fparams = self._gene_lookup_exists_sql(keys)
                if f.operator == "!":
                    if frag == "FALSE":
                        continue
                    clauses.append(
                        frag.replace(
                            "CAST(feature_id AS VARCHAR) IN (",
                            "CAST(feature_id AS VARCHAR) NOT IN (",
                            1,
                        )
                    )
                    params.extend(fparams)
                else:
                    if frag == "FALSE":
                        return "FALSE", [], True
                    clauses.append(frag)
                    params.extend(fparams)
            elif f.kind == "custom" and f.id.startswith("resource:"):
                resource = f.id.split(":", 1)[1]
                clauses.append("CAST(resource AS VARCHAR) = ?")
                params.append(resource)
            else:
                raise ValueError(f"unhandled feature filter: {f.id}")
        if not clauses:
            return "", [], False
        return " AND ".join(clauses), params, False

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

    def list_features_page(
        self,
        *,
        skip: int = 0,
        limit: int = 10,
        filters: Optional[Sequence[Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        if self._has_feature_indexes and self._feature_index_view:
            return self._list_features_page_indexed(
                skip=skip, limit=limit, filters=filters
            )
        return self._list_features_page_union(
            skip=skip, limit=limit, filters=filters
        )

    def _list_features_page_indexed(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._feature_index_view
        assert view is not None
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_sql = ""
        params: List[Any] = []
        if filters:
            frag, fparams, empty = self._feature_filter_sql(
                filters, use_ontology_index=True
            )
            if empty:
                return [], 0
            if frag:
                where_sql = f"WHERE {frag}"
                params.extend(fparams)
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
            FROM {view}
            {where_sql}
            ORDER BY wrapper_id
            LIMIT ? OFFSET ?
            """,
            params + [limit, skip],
        )
        out_rows = [dict(zip(cols, tup)) for tup in rows]
        self._attach_feature_matrix_ids(out_rows)
        return (
            [self._hydrate_feature_row(r) for r in out_rows],
            int(total),
        )

    def _list_features_page_union(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._all_features_view
        if not view:
            return [], 0
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_sql = ""
        params: List[Any] = []
        if filters:
            frag, fparams, empty = self._feature_filter_sql(filters)
            if empty:
                return [], 0
            if frag:
                where_sql = f"WHERE {frag}"
                params.extend(fparams)
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
            return self._hydrate_feature_row(row)

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
        return self._hydrate_feature_row(dict(zip(cols, rows[0])))

    def _biosample_filter_sql(
        self,
        filters: Sequence[Any],
        *,
        available_cols: Optional[Set[str]] = None,
    ) -> Tuple[str, List[Any], bool]:
        """Return (AND sql without leading AND, params, empty_forced) for biosamples."""
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
            if f.kind == "alphanumeric" and f.id in (
                "sex",
                "age_bracket",
                "condition",
                "timepoint",
            ):
                col = f.id
                if not _require_col(col):
                    continue
                if f.operator == "=":
                    clauses.append(f"CAST({col} AS VARCHAR) = ?")
                    params.append(f.value)
                elif f.operator == "!":
                    clauses.append(
                        f"({col} IS NULL OR CAST({col} AS VARCHAR) != ?)"
                    )
                    params.append(f.value)
                else:
                    raise ValueError(f"unsupported {col} operator: {f.operator}")
            elif f.kind == "alphanumeric" and f.id in ("rin", "ischemic_time_min"):
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
        return self._with_expression_summary(doc, row, kind="biosample")

    def list_biosamples(self) -> List[Dict[str, Any]]:
        page, _ = self.list_biosamples_page(skip=0, limit=MAX_PAGE_LIMIT)
        return page

    def list_biosamples_page(
        self,
        *,
        skip: int = 0,
        limit: int = 10,
        filters: Optional[Sequence[Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        if self._has_biosample_indexes and self._biosamples_global_view:
            return self._list_biosamples_page_indexed(
                skip=skip, limit=limit, filters=filters
            )
        return self._list_biosamples_page_union(
            skip=skip, limit=limit, filters=filters
        )

    def _list_biosamples_page_indexed(
        self,
        *,
        skip: int,
        limit: int,
        filters: Optional[Sequence[Any]],
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._biosamples_global_view
        assert view is not None
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_sql = ""
        params: List[Any] = []
        if filters:
            frag, fparams, empty = self._biosample_filter_sql(
                filters, available_cols=self._view_columns(view)
            )
            if empty:
                return [], 0
            if frag:
                where_sql = f"WHERE {frag}"
                params.extend(fparams)
        if filters or self._global_biosample_count is None:
            one = self._fetchone(
                f"SELECT COUNT(*) FROM {view} {where_sql}",
                params if params else None,
            )
            total = int(one[0]) if one else 0
            if not filters:
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
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._all_biosamples_view
        if not view:
            return [], 0
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        where_sql = ""
        params: List[Any] = []
        if filters:
            frag, fparams, empty = self._biosample_filter_sql(
                filters, available_cols=self._view_columns(view)
            )
            if empty:
                return [], 0
            if frag:
                where_sql = f"WHERE {frag}"
                params.extend(fparams)
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

    def matrices_for_feature(self, feature_id: str) -> List[Dict[str, Any]]:
        feature = self.get_feature(feature_id)
        if not feature:
            return []
        ids = feature.get("matrixIds") or []
        return [self._matrices_by_id[i] for i in ids if i in self._matrices_by_id]

    def matrices_for_biosample(self, biosample_id: str) -> List[Dict[str, Any]]:
        ids = self._biosample_matrices.get(biosample_id) or []
        return [self._matrices_by_id[i] for i in ids if i in self._matrices_by_id]

    def features_for_matrix(self, matrix_id: str) -> List[Dict[str, Any]]:
        """Legacy full list — prefer features_for_matrix_page."""
        page, _ = self.features_for_matrix_page(
            matrix_id, skip=0, limit=MAX_PAGE_LIMIT
        )
        return page

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
        self, view: str, filters: Sequence[Any]
    ) -> Tuple[str, List[Any], bool]:
        """Feature-scoped filters against one matrix ``features`` view.

        Returns (AND fragment without leading AND, params, empty_forced).
        Missing optional columns degrade instead of failing the query.
        """
        from beacon.filters import (
            gene_public_id_lookup_keys,
            is_feature_ontology_filter,
            is_gene_public_id_filter,
        )

        cols = self._view_columns(view)
        clauses: List[str] = []
        params: List[Any] = []
        for filt in filters:
            if is_feature_ontology_filter(filt):
                parts: List[str] = []
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
            elif filt.kind == "alphanumeric" and filt.id == "genomicFeature.symbol":
                keys = [filt.value or ""]
                frag, fparams = self._gene_lookup_exists_sql(keys)
                if filt.operator == "!":
                    if frag == "FALSE":
                        continue
                    clauses.append(
                        frag.replace(
                            "CAST(feature_id AS VARCHAR) IN (",
                            "CAST(feature_id AS VARCHAR) NOT IN (",
                            1,
                        )
                    )
                    params.extend(fparams)
                else:
                    if frag == "FALSE":
                        return "FALSE", [], True
                    clauses.append(frag)
                    params.extend(fparams)
            elif filt.kind == "custom" and str(filt.id).startswith("resource:"):
                if cols and "resource" not in cols:
                    return "FALSE", [], True
                clauses.append("CAST(resource AS VARCHAR) = ?")
                params.append(str(filt.id).split(":", 1)[1])
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
                view, feature_filters
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

    def biosamples_for_matrix(self, matrix_id: str) -> List[Dict[str, Any]]:
        page, _ = self.biosamples_for_matrix_page(
            matrix_id, skip=0, limit=MAX_PAGE_LIMIT
        )
        return page

    def _matrix_bio_filter_clause(
        self, bio_view: str, filters: Optional[Sequence[Any]]
    ) -> Tuple[str, List[Any]]:
        if not filters:
            return "", []
        cols = self._view_columns(bio_view)
        frag, params, _empty = self._biosample_filter_sql(
            filters, available_cols=cols
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
            bio_view, biosample_filters
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
                filters, available_cols=cols
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
            out.append(self._with_expression_summary(doc, row, kind="biosample"))
        return out, int(total)

    def _resolve_feature_filter_ids(
        self, feature_id_list: Optional[str], matrix_id: Optional[str] = None
    ) -> Set[str]:
        tokens = _csv_set(feature_id_list)
        if not tokens:
            return set()
        resolved: Set[str] = set(tokens)

        # Map Beacon wrapper_id / native feature_id via SQL catalog.
        view = self._all_features_view
        if view:
            try:
                placeholders = ", ".join(["?"] * len(tokens))
                q = f"""
                SELECT DISTINCT feature_id
                FROM {view}
                WHERE (wrapper_id IN ({placeholders})
                   OR feature_id IN ({placeholders}))
                """
                params: List[Any] = list(tokens) + list(tokens)
                if matrix_id:
                    q += " AND matrix_id = ?"
                    params.append(matrix_id)
                rows, _ = self._fetchall(q, params)
                for (fid,) in rows:
                    if fid:
                        resolved.add(str(fid))
            except duckdb.Error as exc:
                logger.warning("all_features id resolve failed: %s", exc)

        if self._has_gene_lookup:
            try:
                lookup_cols = self._view_columns("gene_lookup")
                if "lookup_key_norm" in lookup_cols:
                    norms = [t.upper() for t in tokens]
                    placeholders = ", ".join(["?"] * len(norms))
                    q = f"""
                    SELECT DISTINCT feature_id
                    FROM gene_lookup
                    WHERE lookup_key_norm IN ({placeholders})
                    """
                    params = list(norms)
                else:
                    placeholders = ", ".join(["?"] * len(tokens))
                    upper_tokens = [t.upper() for t in tokens]
                    q = f"""
                    SELECT DISTINCT feature_id
                    FROM gene_lookup
                    WHERE (lookup_key IN ({placeholders})
                       OR upper(lookup_key) IN ({", ".join(["?"] * len(upper_tokens))}))
                    """
                    params = list(tokens) + upper_tokens
                if matrix_id:
                    mat = self._matrices_by_id.get(matrix_id) or {}
                    ann = mat.get("annotation") or {}
                    src = ann.get("source")
                    ver = str(ann.get("version") or "")
                    if src and ver:
                        q += (
                            " AND annotation_source = ?"
                            " AND annotation_version = ?"
                        )
                        params = list(params) + [src, ver]
                rows, _ = self._fetchall(q, params)
                for (fid,) in rows:
                    if fid:
                        resolved.add(str(fid))
            except duckdb.Error as exc:
                logger.warning("gene_lookup resolve failed: %s", exc)

        return resolved

    def expression_values_for_matrix(
        self,
        matrix_id: str,
        *,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
        biosample_filters: Optional[Sequence[Any]] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        skip: int = 0,
        limit: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Return (page_rows, total_count) with filters pushed into DuckDB."""
        view = self._expr_views.get(matrix_id)
        if not view:
            return [], 0

        feature_ids = self._resolve_feature_filter_ids(feature_id_list, matrix_id)
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
                return [], 0
        filtered = bool(
            feature_ids
            or cohort_sql
            or min_value is not None
            or max_value is not None
        )

        where = ["1=1"]
        params: List[Any] = []
        if feature_ids:
            placeholders = ", ".join(["?"] * len(feature_ids))
            where.append(f"feature_id IN ({placeholders})")
            params.extend(sorted(feature_ids))
        if cohort_sql:
            where.append(f"CAST(biosample_id AS VARCHAR) IN ({cohort_sql})")
            params.extend(cohort_params)
        if min_value is not None:
            where.append("value >= ?")
            params.append(min_value)
        if max_value is not None:
            where.append("value <= ?")
            params.append(max_value)

        where_sql = " AND ".join(where)
        skip = max(0, min(int(skip), MAX_SKIP))

        if not filtered:
            total = self._expression_row_total(matrix_id)
            if total is None:
                one = self._fetchone(
                    f"SELECT COUNT(*) FROM {view} WHERE {where_sql}", params
                )
                total = int(one[0]) if one else 0
            if limit is None:
                limit = min(int(total), MAX_PAGE_LIMIT)
            else:
                limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
            if limit <= 0:
                return [], int(total)
            page_sql = f"""
                SELECT matrix_id, feature_id, biosample_id, value
                FROM {view}
                WHERE {where_sql}
                LIMIT ? OFFSET ?
            """
            rows, _ = self._fetchall(page_sql, list(params) + [limit, skip])
        else:
            if limit is None:
                limit = MAX_PAGE_LIMIT
            else:
                limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
            if limit <= 0:
                one = self._fetchone(
                    f"SELECT COUNT(*) FROM {view} WHERE {where_sql}", params
                )
                total = int(one[0]) if one else 0
                return [], total
            # One pass: window count plus the ordered page.
            page_sql = f"""
                SELECT matrix_id, feature_id, biosample_id, value,
                       COUNT(*) OVER() AS _total
                FROM {view}
                WHERE {where_sql}
                ORDER BY feature_id, biosample_id
                LIMIT ? OFFSET ?
            """
            rows, _ = self._fetchall(page_sql, list(params) + [limit, skip])
            if rows:
                total = int(rows[0][-1])
                rows = [row[:-1] for row in rows]
            else:
                one = self._fetchone(
                    f"SELECT COUNT(*) FROM {view} WHERE {where_sql}", params
                )
                total = int(one[0]) if one else 0
                rows = []
        out: List[Dict[str, Any]] = []
        for matrix_id_v, feature_id, biosample_id, value in rows:
            mid = str(matrix_id_v)
            fid = str(feature_id)
            bid = str(biosample_id)
            out.append(
                {
                    "id": f"{mid}:{fid}:{bid}",
                    "matrixId": mid,
                    "featureId": fid,
                    "biosampleId": bid,
                    "value": float(value) if value is not None else None,
                }
            )
        return out, int(total)

    def _expression_group_by_sql(
        self, bio_view: str, group_by: Optional[str]
    ) -> Optional[str]:
        if not group_by:
            return None
        cols = self._view_columns(bio_view)
        col_map = {
            "sex": "sex",
            "condition": "condition",
            "age_bracket": "age_bracket",
            "tissue": "ontology_label",
            "biosampleStatus": "biosample_status_label",
        }
        if group_by in col_map:
            name = col_map[group_by]
            if cols and name not in cols:
                return None
            return f"CAST(b.{name} AS VARCHAR)"
        if group_by == "phenotype":
            if cols and "phenotype_labels" in cols:
                return "CAST(b.phenotype_labels[1] AS VARCHAR)"
            if cols and "phenotype_ids" in cols:
                return "CAST(b.phenotype_ids[1] AS VARCHAR)"
            if not cols:
                return (
                    "COALESCE("
                    "CAST(b.phenotype_labels[1] AS VARCHAR), "
                    "CAST(b.phenotype_ids[1] AS VARCHAR)"
                    ")"
                )
            return None
        return None

    def expression_summary_for_matrix(
        self,
        matrix_id: str,
        *,
        feature_id_list: Optional[str] = None,
        group_by: Optional[str] = None,
        biosample_filters: Optional[Sequence[Any]] = None,
        threshold: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        view = self._expr_views.get(matrix_id)
        bio_view = self._bio_views.get(matrix_id)
        if not view or not bio_view:
            return []
        feature_ids = sorted(
            self._resolve_feature_filter_ids(feature_id_list, matrix_id)
        )
        if not feature_ids:
            return []
        if len(feature_ids) > MAX_ID_LIST_TOKENS:
            raise ValueError(
                f"resolved featureIDList exceeds {MAX_ID_LIST_TOKENS} entries"
            )
        bio_where, bio_params = self._matrix_bio_filter_clause(
            bio_view, biosample_filters
        )
        if bio_where:
            one = self._fetchone(
                f"SELECT 1 FROM {bio_view}{bio_where} LIMIT 1",
                bio_params if bio_params else None,
            )
            if one is None:
                return []
        group_col = self._expression_group_by_sql(bio_view, group_by)
        join_filter = bio_where.replace(" WHERE ", " AND ", 1) if bio_where else ""
        group_select = f", {group_col} AS group_key" if group_col else ""
        group_by_sql = (
            " GROUP BY e.feature_id, group_key" if group_col else " GROUP BY e.feature_id"
        )
        thr_sql = ""
        thr_params: List[Any] = []
        if threshold is not None:
            thr_sql = ", SUM(CASE WHEN e.value >= ? THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS fractionAboveThreshold"
            thr_params = [threshold]
        placeholders = ", ".join(["?"] * len(feature_ids))
        sql = f"""
            SELECT
              e.feature_id AS featureId,
              COUNT(*)::INTEGER AS n,
              AVG(e.value) AS mean,
              quantile_cont(e.value, 0.5) AS median,
              quantile_cont(e.value, 0.25) AS q1,
              quantile_cont(e.value, 0.75) AS q3,
              MIN(e.value) AS min,
              MAX(e.value) AS max,
              arg_min(e.biosample_id, e.value) AS minBiosampleId,
              arg_max(e.biosample_id, e.value) AS maxBiosampleId
              {thr_sql}
              {group_select}
            FROM {view} e
            INNER JOIN {bio_view} b
              ON CAST(e.biosample_id AS VARCHAR) = CAST(b.biosample_id AS VARCHAR)
            WHERE e.feature_id IN ({placeholders})
            {join_filter}
            {group_by_sql}
            ORDER BY e.feature_id{', group_key' if group_col else ''}
        """
        params: List[Any] = list(feature_ids) + bio_params + thr_params
        rows, cols = self._fetchall(sql, params)
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            rec: Dict[str, Any] = {
                "id": f"{matrix_id}:{row.get('featureId')}:{row.get('group_key') or 'all'}",
                "matrixId": matrix_id,
                "featureId": str(row.get("featureId")),
                "n": int(row.get("n") or 0),
                "mean": float(row["mean"]) if row.get("mean") is not None else None,
                "median": float(row["median"]) if row.get("median") is not None else None,
                "q1": float(row["q1"]) if row.get("q1") is not None else None,
                "q3": float(row["q3"]) if row.get("q3") is not None else None,
                "min": float(row["min"]) if row.get("min") is not None else None,
                "max": float(row["max"]) if row.get("max") is not None else None,
            }
            if row.get("minBiosampleId") is not None:
                rec["minBiosampleId"] = str(row["minBiosampleId"])
            if row.get("maxBiosampleId") is not None:
                rec["maxBiosampleId"] = str(row["maxBiosampleId"])
            if threshold is not None and row.get("fractionAboveThreshold") is not None:
                rec["fractionAboveThreshold"] = float(row["fractionAboveThreshold"])
            if group_col and row.get("group_key") is not None:
                rec["group"] = {"id": str(row["group_key"]), "label": str(row["group_key"])}
            out.append(rec)
        return out

