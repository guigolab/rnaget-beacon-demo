from typing import Any, Dict, List, Optional, Set

from .loader import load_all, strip_schema

_STORE: Optional["FixtureStore"] = None


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

    def expression_values_for_matrix(
        self,
        matrix_id: str,
        *,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
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
        return out

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


def get_store() -> FixtureStore:
    global _STORE
    if _STORE is None:
        _STORE = FixtureStore()
    return _STORE
