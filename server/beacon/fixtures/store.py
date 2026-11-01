import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from .loader import load_all, strip_schema

logger = logging.getLogger(__name__)

_STORE: Optional[Any] = None
_STORE_LOCK = threading.Lock()


class FixtureStore:
    def __init__(self, data: Optional[Dict[str, Any]] = None):
        raw = data or load_all()
        self.matrices: List[Dict[str, Any]] = strip_schema(raw["matrices"])
        self.features: List[Dict[str, Any]] = strip_schema(raw["features"])
        self.biosamples: List[Dict[str, Any]] = strip_schema(raw["biosamples"])
        self.expression_values: List[Dict[str, Any]] = strip_schema(
            raw["expressionValues"]
        )
        self.biosample_matrices: Dict[str, List[str]] = raw["biosampleMatrices"]

        self._matrices_by_id = {m["matrixId"]: m for m in self.matrices}
        self._features_by_id = {f["id"]: f for f in self.features}
        self._biosamples_by_id = {b["id"]: b for b in self.biosamples}

    def list_matrices(self) -> List[Dict[str, Any]]:
        return list(self.matrices)

    def get_matrix(self, matrix_id: str) -> Optional[Dict[str, Any]]:
        return self._matrices_by_id.get(matrix_id)

    def list_features(self) -> List[Dict[str, Any]]:
        return list(self.features)

    def list_features_page(
        self, *, skip: int = 0, limit: int = 10
    ) -> Tuple[List[Dict[str, Any]], int]:
        total = len(self.features)
        return self.features[skip : skip + limit], total

    def get_feature(self, feature_id: str) -> Optional[Dict[str, Any]]:
        return self._features_by_id.get(feature_id)

    def list_biosamples(self) -> List[Dict[str, Any]]:
        return list(self.biosamples)

    def get_biosample(self, biosample_id: str) -> Optional[Dict[str, Any]]:
        return self._biosamples_by_id.get(biosample_id)

    def matrices_for_feature(self, feature_id: str) -> List[Dict[str, Any]]:
        feature = self.get_feature(feature_id)
        if not feature:
            return []
        ids = feature.get("matrixIds") or []
        return [self._matrices_by_id[i] for i in ids if i in self._matrices_by_id]

    def matrices_for_biosample(self, biosample_id: str) -> List[Dict[str, Any]]:
        ids = self.biosample_matrices.get(biosample_id) or []
        return [self._matrices_by_id[i] for i in ids if i in self._matrices_by_id]

    def features_for_matrix(self, matrix_id: str) -> List[Dict[str, Any]]:
        return [
            f
            for f in self.features
            if matrix_id in (f.get("matrixIds") or [])
        ]

    def effective_axis_sort(
        self,
        matrix_id: str,
        *,
        axis: str,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> Tuple[str, str]:
        """Fixtures have no expression stats — expression.* sorts degrade to id."""
        del matrix_id, axis  # unused; signature matches DuckDBStore
        s = (sort or "id").strip()
        o = (order or "asc").strip().lower()
        if s.startswith("expression."):
            s = "id"
        if o not in ("asc", "desc"):
            o = "asc"
        if s != "id":
            s = "id"
        return s, o

    def features_for_matrix_page(
        self,
        matrix_id: str,
        *,
        skip: int = 0,
        limit: int = 10,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        all_feats = self.features_for_matrix(matrix_id)
        _, order_key = self.effective_axis_sort(
            matrix_id, axis="features", sort=sort, order=order
        )
        reverse = order_key == "desc"
        all_feats = sorted(
            all_feats,
            key=lambda f: f.get("id") or "",
            reverse=reverse,
        )
        return all_feats[skip : skip + limit], len(all_feats)

    def biosamples_for_matrix(self, matrix_id: str) -> List[Dict[str, Any]]:
        ids: Set[str] = set()
        for bid, mids in self.biosample_matrices.items():
            if matrix_id in mids:
                ids.add(bid)
        for ev in self.expression_values:
            if ev.get("matrixId") == matrix_id:
                ids.add(ev["biosampleId"])
        return [
            self._biosamples_by_id[i]
            for i in sorted(ids)
            if i in self._biosamples_by_id
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
        items = self.biosamples_for_matrix(matrix_id)
        _, order_key = self.effective_axis_sort(
            matrix_id, axis="biosamples", sort=sort, order=order
        )
        reverse = order_key == "desc"
        items = sorted(items, key=lambda b: b.get("id") or "", reverse=reverse)
        return items[skip : skip + limit], len(items)

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
        feature_ids = self._resolve_feature_filter_ids(feature_id_list)
        biosample_ids = _csv_set(biosample_id_list)
        out = []
        for ev in self.expression_values:
            if ev.get("matrixId") != matrix_id:
                continue
            if feature_ids and ev.get("featureId") not in feature_ids:
                continue
            if biosample_ids and ev.get("biosampleId") not in biosample_ids:
                continue
            value = ev.get("value")
            if min_value is not None and value is not None and value < min_value:
                continue
            if max_value is not None and value is not None and value > max_value:
                continue
            out.append(ev)
        total = len(out)
        if limit is None:
            page = out[skip:]
        else:
            page = out[skip : skip + limit]
        return page, total

    def _resolve_feature_filter_ids(self, feature_id_list: Optional[str]) -> Set[str]:
        """Accept genomic accessions and/or feature wrapper ids."""
        tokens = _csv_set(feature_id_list)
        if not tokens:
            return set()
        resolved: Set[str] = set()
        for token in tokens:
            resolved.add(token)
            feature = self._features_by_id.get(token)
            if feature:
                genomic = (
                    (feature.get("genomicFeature") or {})
                    .get("featureIdentifier", {})
                    .get("id")
                )
                if genomic:
                    resolved.add(genomic)
        return resolved


def _csv_set(value: Optional[str]) -> Set[str]:
    if not value:
        return set()
    return {part.strip() for part in value.split(",") if part.strip()}


def get_store() -> Any:
    """Return DuckDBStore when DATA_PACKAGE_PATH is set; otherwise FixtureStore.

    If DATA_PACKAGE_PATH is set but manifest.json is missing, raise immediately
    (do not silently fall back to fixtures).
    """
    global _STORE
    if _STORE is not None:
        return _STORE
    with _STORE_LOCK:
        if _STORE is not None:
            return _STORE
        package = os.environ.get("DATA_PACKAGE_PATH", "").strip()
        if package:
            manifest = Path(package) / "manifest.json"
            if not manifest.is_file():
                raise FileNotFoundError(
                    f"DATA_PACKAGE_PATH={package!r} is set but "
                    f"{manifest} is missing (refusing fixture fallback)"
                )
            from beacon.duckdb_store import DuckDBStore

            logger.info("Loading DuckDBStore from DATA_PACKAGE_PATH=%s", package)
            _STORE = DuckDBStore(Path(package))
        else:
            logger.info(
                "DATA_PACKAGE_PATH unset; using FixtureStore (demo JSON fixtures)"
            )
            _STORE = FixtureStore()
        return _STORE


def reset_store() -> None:
    """Clear singleton (tests / reload after package swap)."""
    global _STORE
    with _STORE_LOCK:
        _STORE = None
