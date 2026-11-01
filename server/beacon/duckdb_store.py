"""DuckDB-backed Beacon store over a Parquet data package."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import duckdb

logger = logging.getLogger(__name__)

# Cap page size for expression / feature list endpoints (also enforced in deps).
MAX_PAGE_LIMIT = 1000

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

        self._lock = threading.Lock()
        self.con = duckdb.connect(database=":memory:")
        from beacon.duckdb_settings import configure_duckdb_connection

        configure_duckdb_connection(self.con)
        self._expr_views: Dict[str, str] = {}
        self._feat_views: Dict[str, str] = {}
        self._bio_views: Dict[str, str] = {}
        self._feat_stats_views: Dict[str, str] = {}
        self._bio_stats_views: Dict[str, str] = {}
        self._all_features_view: Optional[str] = None
        self._global_feature_count: Optional[int] = None
        self._feature_counts: Dict[str, int] = {}

        self._biosamples_cache: List[Dict[str, Any]] = []
        self._biosamples_by_id: Dict[str, Dict[str, Any]] = {}
        self._biosample_matrices: Dict[str, List[str]] = {}
        self._register_views()
        self._load_indexes()

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
        with self._lock:
            rel = self.con.execute(sql) if params is None else self.con.execute(sql, params)
            cols = [c[0] for c in (rel.description or [])]
            return rel.fetchall(), cols

    def _fetchone(
        self, sql: str, params: Optional[List[Any]] = None
    ) -> Optional[Tuple[Any, ...]]:
        with self._lock:
            rel = self.con.execute(sql) if params is None else self.con.execute(sql, params)
            return rel.fetchone()

    def _register_views(self) -> None:
        genes = self.package_path / "genes.parquet"
        lookup = self.package_path / "gene_lookup.parquet"
        if genes.is_file():
            self._execute(
                f"CREATE VIEW genes AS SELECT * FROM read_parquet('{_sql_path(genes)}')"
            )
        if lookup.is_file():
            self._execute(
                f"CREATE VIEW gene_lookup AS SELECT * FROM read_parquet('{_sql_path(lookup)}')"
            )

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
            parts = [
                f"SELECT CAST(feature_id AS VARCHAR) AS feature_id, "
                f"CAST(wrapper_id AS VARCHAR) AS wrapper_id, "
                f"symbol, resource, feature_type_id, feature_type_label, aliases, "
                f"CAST(matrix_id AS VARCHAR) AS matrix_id "
                f"FROM {view}"
                for view in self._feat_views.values()
            ]
            self._all_features_view = "all_features"
            self._execute(
                f"CREATE VIEW {self._all_features_view} AS " + " UNION ALL ".join(parts)
            )

    def _load_indexes(self) -> None:
        """Load biosample docs (small) + per-matrix feature counts via SQL COUNT.

        Global feature identity maps are not materialised in Python; use
        ``all_features`` SQL view for /features paging and lookups.
        """
        for mid, view in self._feat_views.items():
            one = self._fetchone(f"SELECT COUNT(*) FROM {view}")
            self._feature_counts[mid] = int(one[0]) if one else 0

        bio_matrices: Dict[str, Set[str]] = {}
        biosamples: List[Dict[str, Any]] = []
        for mid, view in self._bio_views.items():
            rows, cols = self._fetchall(f"SELECT * FROM {view}")
            for tup in rows:
                row = dict(zip(cols, tup))
                doc = self._biosample_doc(row)
                bid = doc["id"]
                bio_matrices.setdefault(bid, set()).add(mid)
                if bid not in self._biosamples_by_id:
                    self._biosamples_by_id[bid] = doc
                    biosamples.append(doc)

        self._biosamples_cache = biosamples
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
        if symbol and symbol not in aliases:
            aliases = [symbol] + aliases
        ft_id = row.get("feature_type_id") or "SO:0000704"
        ft_label = row.get("feature_type_label") or "gene"
        if ft_id is not None and _is_nan(ft_id):
            ft_id = "SO:0000704"
        if ft_label is not None and _is_nan(ft_label):
            ft_label = "gene"
        doc: Dict[str, Any] = {
            "id": str(wrapper_id),
            "genomicFeature": {
                "featureIdentifier": {"id": feature_id, "resource": str(resource)},
                "featureType": {"id": str(ft_id), "label": str(ft_label)},
                "aliases": aliases,
            },
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
        doc: Dict[str, Any] = {
            "id": bid,
            "biosampleId": bid,
            "biosampleStatus": {
                "id": "EFO:0009654",
                "label": "reference sample",
            },
            "sampleOriginType": {
                "id": ontology_id or "UBERON:0001062",
                "label": ontology_label or "anatomical entity",
            },
        }
        if ontology_id or ontology_label:
            doc["sampleType"] = {
                "id": ontology_id,
                "label": ontology_label,
            }
        for key in ("sex", "donor", "summary", "lab"):
            val = row.get(key)
            if val is not None and not _is_nan(val):
                doc[key] = val
        return doc

    def _expression_row_total(self, matrix_id: str) -> Optional[int]:
        if matrix_id in self._manifest_expr_rows:
            return self._manifest_expr_rows[matrix_id]
        mat = self._matrices_by_id.get(matrix_id) or {}
        pkg = mat.get("package") or (mat.get("info") or {}).get("package") or {}
        if pkg.get("expressionRows") is not None:
            return int(pkg["expressionRows"])
        dims = mat.get("dimensions") or {}
        n_feat = dims.get("features") or dims.get("nFeatures")
        n_bio = dims.get("biosamples") or dims.get("nBiosamples")
        if n_feat is not None and n_bio is not None:
            return int(n_feat) * int(n_bio)
        return None

    # --- FixtureStore-compatible API ---

    def list_matrices(self) -> List[Dict[str, Any]]:
        return list(self.matrices)

    def get_matrix(self, matrix_id: str) -> Optional[Dict[str, Any]]:
        return self._matrices_by_id.get(matrix_id)

    def list_features(self) -> List[Dict[str, Any]]:
        """Legacy full list — prefer list_features_page (loads all wrappers via SQL)."""
        page, _ = self.list_features_page(skip=0, limit=MAX_PAGE_LIMIT)
        return page

    def list_features_page(
        self, *, skip: int = 0, limit: int = 10
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._all_features_view
        if not view:
            return [], 0
        if self._global_feature_count is None:
            one = self._fetchone(
                f"SELECT COUNT(DISTINCT wrapper_id) FROM {view}"
            )
            self._global_feature_count = int(one[0]) if one else 0
        total = self._global_feature_count
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
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
              list(DISTINCT matrix_id) AS matrix_ids
            FROM {view}
            GROUP BY wrapper_id
            ORDER BY wrapper_id
            LIMIT ? OFFSET ?
            """,
            [limit, skip],
        )
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            out.append(self._hydrate_feature_row(row))
        return out, int(total)

    def get_feature(self, feature_id: str) -> Optional[Dict[str, Any]]:
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
              list(DISTINCT matrix_id) AS matrix_ids
            FROM {view}
            WHERE wrapper_id = ? OR feature_id = ?
            GROUP BY wrapper_id
            LIMIT 1
            """,
            [feature_id, feature_id],
        )
        if not rows:
            return None
        return self._hydrate_feature_row(dict(zip(cols, rows[0])))

    def list_biosamples(self) -> List[Dict[str, Any]]:
        return list(self._biosamples_cache)

    def get_biosample(self, biosample_id: str) -> Optional[Dict[str, Any]]:
        return self._biosamples_by_id.get(biosample_id)

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

    def features_for_matrix_page(
        self,
        matrix_id: str,
        *,
        skip: int = 0,
        limit: int = 10,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        view = self._feat_views.get(matrix_id)
        if not view:
            return [], 0
        total = self._feature_counts.get(matrix_id)
        if total is None:
            one = self._fetchone(f"SELECT COUNT(*) FROM {view}")
            total = int(one[0]) if one else 0
            self._feature_counts[matrix_id] = total
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        sort_key, order_key = self.effective_axis_sort(
            matrix_id, axis="features", sort=sort, order=order
        )
        stats = self._feat_stats_views.get(matrix_id)
        order_sql = "ASC" if order_key == "asc" else "DESC"
        feat_join = (
            f"CAST(f.feature_id AS VARCHAR) = CAST(s.feature_id AS VARCHAR)"
        )
        if sort_key == "expression.max" and stats:
            sql = f"""
                SELECT f.*, s.min_value, s.max_value,
                       s.min_biosample_id, s.max_biosample_id
                FROM {view} f
                LEFT JOIN {stats} s ON {feat_join}
                ORDER BY s.max_value {order_sql} NULLS LAST,
                         CAST(f.feature_id AS VARCHAR) ASC
                LIMIT ? OFFSET ?
            """
        elif sort_key == "expression.min" and stats:
            sql = f"""
                SELECT f.*, s.min_value, s.max_value,
                       s.min_biosample_id, s.max_biosample_id
                FROM {view} f
                LEFT JOIN {stats} s ON {feat_join}
                ORDER BY s.min_value {order_sql} NULLS LAST,
                         CAST(f.feature_id AS VARCHAR) ASC
                LIMIT ? OFFSET ?
            """
        elif stats:
            sql = f"""
                SELECT f.*, s.min_value, s.max_value,
                       s.min_biosample_id, s.max_biosample_id
                FROM {view} f
                LEFT JOIN {stats} s ON {feat_join}
                ORDER BY CAST(f.feature_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        else:
            sql = f"""
                SELECT * FROM {view}
                ORDER BY CAST(feature_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        rows, cols = self._fetchall(sql, [limit, skip])
        out: List[Dict[str, Any]] = []
        for tup in rows:
            row = dict(zip(cols, tup))
            out.append(self._feature_doc_from_row(row, [matrix_id]))
        return out, int(total)

    def biosamples_for_matrix(self, matrix_id: str) -> List[Dict[str, Any]]:
        return [
            self._biosamples_by_id[bid]
            for bid, mids in self._biosample_matrices.items()
            if matrix_id in mids and bid in self._biosamples_by_id
        ]

    def biosamples_for_matrix_page(
        self,
        matrix_id: str,
        *,
        skip: int = 0,
        limit: int = 10,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Paged biosamples for a matrix with optional expression stats sort."""
        bio_view = self._bio_views.get(matrix_id)
        sort_key, order_key = self.effective_axis_sort(
            matrix_id, axis="biosamples", sort=sort, order=order
        )
        if not bio_view:
            # Fall back to in-memory index (id sort only).
            items = self.biosamples_for_matrix(matrix_id)
            total = len(items)
            reverse = order_key == "desc"
            items = sorted(items, key=lambda d: d.get("id") or "", reverse=reverse)
            limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
            skip = max(0, int(skip))
            return items[skip : skip + limit], total

        one = self._fetchone(f"SELECT COUNT(*) FROM {bio_view}")
        total = int(one[0]) if one else 0
        limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))
        stats = self._bio_stats_views.get(matrix_id)
        order_sql = "ASC" if order_key == "asc" else "DESC"
        if sort_key == "expression.max" and stats:
            sql = f"""
                SELECT b.*, s.min_value, s.max_value,
                       s.min_feature_id, s.max_feature_id
                FROM {bio_view} b
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
                FROM {bio_view} b
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
                FROM {bio_view} b
                LEFT JOIN {stats} s
                  ON CAST(b.biosample_id AS VARCHAR) = CAST(s.biosample_id AS VARCHAR)
                ORDER BY CAST(b.biosample_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        else:
            sql = f"""
                SELECT * FROM {bio_view}
                ORDER BY CAST(biosample_id AS VARCHAR) {order_sql}
                LIMIT ? OFFSET ?
            """
        rows, cols = self._fetchall(sql, [limit, skip])
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
                WHERE wrapper_id IN ({placeholders})
                   OR feature_id IN ({placeholders})
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

        try:
            placeholders = ", ".join(["?"] * len(tokens))
            upper_tokens = [t.upper() for t in tokens]
            q = f"""
            SELECT DISTINCT feature_id
            FROM gene_lookup
            WHERE lookup_key IN ({placeholders})
               OR upper(lookup_key) IN ({", ".join(["?"] * len(upper_tokens))})
            """
            params = list(tokens) + upper_tokens
            if matrix_id:
                mat = self._matrices_by_id.get(matrix_id) or {}
                ann = mat.get("annotation") or {}
                src = ann.get("source")
                ver = str(ann.get("version") or "")
                if src and ver:
                    q = f"""
                    SELECT DISTINCT feature_id
                    FROM gene_lookup
                    WHERE (lookup_key IN ({placeholders})
                       OR upper(lookup_key) IN ({", ".join(["?"] * len(upper_tokens))}))
                      AND annotation_source = ?
                      AND annotation_version = ?
                    """
                    params = list(tokens) + upper_tokens + [src, ver]
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
        biosample_ids = _csv_set(biosample_id_list)
        filtered = bool(feature_ids or biosample_ids or min_value is not None or max_value is not None)

        where = ["1=1"]
        params: List[Any] = []
        if feature_ids:
            placeholders = ", ".join(["?"] * len(feature_ids))
            where.append(f"feature_id IN ({placeholders})")
            params.extend(sorted(feature_ids))
        if biosample_ids:
            placeholders = ", ".join(["?"] * len(biosample_ids))
            where.append(f"biosample_id IN ({placeholders})")
            params.extend(sorted(biosample_ids))
        if min_value is not None:
            where.append("value >= ?")
            params.append(min_value)
        if max_value is not None:
            where.append("value <= ?")
            params.append(max_value)

        where_sql = " AND ".join(where)

        if not filtered:
            total = self._expression_row_total(matrix_id)
            if total is None:
                one = self._fetchone(
                    f"SELECT COUNT(*) FROM {view} WHERE {where_sql}", params
                )
                total = int(one[0]) if one else 0
        else:
            one = self._fetchone(
                f"SELECT COUNT(*) FROM {view} WHERE {where_sql}", params
            )
            total = int(one[0]) if one else 0

        if limit is None:
            limit = min(int(total), MAX_PAGE_LIMIT)
        else:
            limit = max(0, min(int(limit), MAX_PAGE_LIMIT))
        skip = max(0, int(skip))

        # Unfiltered pages use storage order (avoids full-table ORDER BY).
        order_sql = "ORDER BY feature_id, biosample_id" if filtered else ""
        page_sql = f"""
            SELECT matrix_id, feature_id, biosample_id, value
            FROM {view}
            WHERE {where_sql}
            {order_sql}
            LIMIT ? OFFSET ?
        """
        page_params = list(params) + [limit, skip]
        rows, _ = self._fetchall(page_sql, page_params)
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


def open_duckdb_store(path: Optional[str] = None) -> DuckDBStore:
    raw = path or os.environ.get("DATA_PACKAGE_PATH", "").strip()
    if not raw:
        raise ValueError("DATA_PACKAGE_PATH is not set")
    return DuckDBStore(Path(raw))
