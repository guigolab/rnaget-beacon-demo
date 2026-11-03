import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from .loader import load_all, strip_schema

logger = logging.getLogger(__name__)

_STORE: Optional[Any] = None
_STORE_LOCK = threading.Lock()

_FIXTURE_FILTERING_TERMS: Dict[str, Any] = {
    "schemaVersion": 1,
    "resources": [
        {
            "id": "so",
            "name": "Sequence Ontology",
            "nameSpacePrefix": "SO",
            "iriPrefix": "http://purl.obolibrary.org/obo/SO_",
            "url": "http://purl.obolibrary.org/obo/so.obo",
        },
        {
            "id": "uberon",
            "name": "Uberon",
            "nameSpacePrefix": "UBERON",
            "iriPrefix": "http://purl.obolibrary.org/obo/UBERON_",
            "url": "http://purl.obolibrary.org/obo/uberon.owl",
        },
        {
            "id": "efo",
            "name": "Experimental Factor Ontology",
            "nameSpacePrefix": "EFO",
            "iriPrefix": "http://www.ebi.ac.uk/efo/EFO_",
            "url": "https://www.ebi.ac.uk/efo/efo.owl",
        },
        {
            "id": "hgnc",
            "name": "HUGO Gene Nomenclature Committee",
            "nameSpacePrefix": "HGNC",
            "iriPrefix": "https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/",
            "url": "https://www.genenames.org",
        },
        {
            "id": "ncbigene",
            "name": "NCBI Gene",
            "nameSpacePrefix": "NCBIGene",
            "iriPrefix": "https://www.ncbi.nlm.nih.gov/gene/",
            "url": "https://www.ncbi.nlm.nih.gov/gene",
        },
        {
            "id": "ensembl",
            "name": "Ensembl",
            "nameSpacePrefix": "ENSEMBL",
            "iriPrefix": "https://www.ensembl.org/id/",
            "url": "https://www.ensembl.org",
        },
        {
            "id": "go",
            "name": "Gene Ontology",
            "nameSpacePrefix": "GO",
            "iriPrefix": "http://purl.obolibrary.org/obo/GO_",
            "url": "http://purl.obolibrary.org/obo/go.owl",
        },
        {
            "id": "symbol",
            "name": "Gene symbol",
            "nameSpacePrefix": "symbol",
            "iriPrefix": "https://www.genenames.org/tools/search/#!/?query=",
            "url": "https://www.genenames.org",
        },
    ],
    "filteringTerms": [
        {
            "type": "SO",
            "id": "SO:0000704",
            "label": "gene",
            "scopes": ["genomicFeature"],
        },
        {
            "type": "SO",
            "id": "SO:0000234",
            "label": "mRNA",
            "scopes": ["genomicFeature"],
        },
        {
            "type": "SO",
            "id": "SO:0001217",
            "label": "protein_coding_gene",
            "scopes": ["genomicFeature"],
        },
        {
            "type": "GO",
            "id": "GO:0008150",
            "label": "biological_process",
            "scopes": ["genomicFeature"],
        },
        {
            "type": "UBERON",
            "id": "UBERON:0000474",
            "label": "female reproductive system",
            "scopes": ["biosample"],
        },
        {
            "type": "UBERON",
            "id": "UBERON:0002107",
            "label": "liver",
            "scopes": ["biosample"],
        },
        {
            "type": "alphanumeric",
            "id": "sex",
            "label": "Sex",
            "scopes": ["biosample"],
            "values": ["female", "male"],
        },
        {
            "type": "custom",
            "id": "resource:ensembl",
            "label": "Annotation resource ensembl",
            "scopes": ["genomicFeature"],
        },
    ],
}


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
        self._filtering_terms_doc = dict(_FIXTURE_FILTERING_TERMS)

    def list_matrices(
        self, filters: Optional[Sequence[Any]] = None
    ) -> List[Dict[str, Any]]:
        from beacon.matrix_catalog import list_matrices_filtered

        return list_matrices_filtered(self.matrices, filters)

    def matrix_filtering_terms(self) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_catalog import build_matrix_filtering_terms

        return build_matrix_filtering_terms(self.matrices)

    def matrix_axis_filtering_terms(
        self, matrix_id: str, axis: str
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_axis_catalog import build_matrix_axis_filtering_terms

        if axis not in ("features", "biosamples"):
            return [], []
        if not self.get_matrix(matrix_id):
            return [], []
        scope = "genomicFeature" if axis == "features" else "biosample"
        global_terms, global_resources = self.filtering_terms(scopes=[scope])
        matrix = self.get_matrix(matrix_id)
        features = self.features_for_matrix(matrix_id) if axis == "features" else []
        biosamples = (
            self.biosamples_for_matrix(matrix_id) if axis == "biosamples" else []
        )
        return build_matrix_axis_filtering_terms(
            axis,  # type: ignore[arg-type]
            features=features,
            biosamples=biosamples,
            matrix=matrix,
            global_terms=global_terms,
            global_resources=global_resources,
        )

    def matrix_scoped_filtering_terms(
        self, matrix_id: str
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_axis_catalog import merge_matrix_scoped_filtering_terms

        if not self.get_matrix(matrix_id):
            return [], []
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
        return self._matrices_by_id.get(matrix_id)

    def list_features(self) -> List[Dict[str, Any]]:
        return list(self.features)

    def filtering_terms(
        self, *, scopes: Optional[Sequence[str]] = None
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from beacon.matrix_catalog_seed import merge_filtering_terms

        doc = self._filtering_terms_doc
        terms = list(doc.get("filteringTerms") or [])
        resources = list(doc.get("resources") or [])
        matrix_terms, matrix_resources = self.matrix_filtering_terms()
        terms = merge_filtering_terms(terms, matrix_terms)
        resources_by_id = {
            str(r.get("id") or ""): dict(r)
            for r in (*resources, *matrix_resources)
            if r.get("id")
        }
        resources = list(resources_by_id.values())
        if scopes:
            want = set(scopes)
            terms = [t for t in terms if want.intersection(t.get("scopes") or [])]
            keep = set()
            if "genomicFeature" in want:
                keep.update({"so", "go", "hgnc", "ncbigene", "ensembl", "symbol"})
            if "biosample" in want:
                keep.update({"uberon", "efo", "obi", "mondo", "hp", "go", "ncit"})
            if "matrix" in want:
                keep.update({"so", "obi"})
            resources = [
                r for r in resources if str(r.get("id") or "").lower() in keep
            ]
        return terms, resources

    def _feature_ids_for_symbol_or_xref(self, key: str) -> Set[str]:
        from beacon.filters import gene_public_id_lookup_keys

        candidates = {k.upper() for k in gene_public_id_lookup_keys(key)}
        candidates.add(key.upper())
        hits: Set[str] = set()
        for f in self.features:
            gf = f.get("genomicFeature") or {}
            aliases = [str(a).upper() for a in (gf.get("aliases") or [])]
            native = str((gf.get("featureIdentifier") or {}).get("id") or "")
            native_u = native.upper()
            native_bare = native_u.rsplit(".", 1)[0] if "." in native_u else native_u
            xrefs = {str(x).upper() for x in (gf.get("xrefs") or [])}
            wid = str(f.get("id") or "")
            if (
                candidates & set(aliases)
                or native_u in candidates
                or native_bare in candidates
                or candidates & xrefs
            ):
                hits.add(wid)
                if native:
                    hits.add(native)
        return hits

    def list_features_page(
        self,
        *,
        skip: int = 0,
        limit: int = 10,
        filters: Optional[Sequence[Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        from beacon.filters import (
            feature_doc_matches,
            is_gene_public_id_filter,
        )

        items = list(self.features)
        if filters:
            # Pre-resolve gene CURIE / symbol to wrapper ids
            allow: Optional[Set[str]] = None
            for f in filters:
                if is_gene_public_id_filter(f):
                    ids = self._feature_ids_for_symbol_or_xref(f.id)
                    allow = ids if allow is None else (allow & ids)
                elif f.kind == "custom" and str(f.id).lower().startswith("symbol:"):
                    from beacon.filters import symbol_custom_lookup_key

                    ids = self._feature_ids_for_symbol_or_xref(
                        symbol_custom_lookup_key(f)
                    )
                    allow = ids if allow is None else (allow & ids)
            if allow is not None:
                if not allow:
                    return [], 0
                items = [
                    feat
                    for feat in items
                    if feat.get("id") in allow
                    or (feat.get("genomicFeature") or {})
                    .get("featureIdentifier", {})
                    .get("id")
                    in allow
                ]
            items = [feat for feat in items if feature_doc_matches(feat, filters)]
        total = len(items)
        return items[skip : skip + limit], total

    def get_feature(self, feature_id: str) -> Optional[Dict[str, Any]]:
        return self._features_by_id.get(feature_id)

    def list_biosamples(self) -> List[Dict[str, Any]]:
        return list(self.biosamples)

    def list_biosamples_page(
        self,
        *,
        skip: int = 0,
        limit: int = 10,
        filters: Optional[Sequence[Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        from beacon.filters import biosample_matches

        items = list(self.biosamples)
        if filters:
            items = [b for b in items if biosample_matches(b, filters)]
        total = len(items)
        return items[skip : skip + limit], total

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

    def matrices_for_feature_page(
        self,
        feature_id: str,
        *,
        filters: Optional[Sequence[Any]] = None,
        matrix_id_list: Optional[str] = None,
        skip: int = 0,
        limit: int = 10,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Fixtures have no expression stats: filter by matrixIDList only."""
        del filters  # no-op; fixtures carry no feature_expression_stats
        feature = self.get_feature(feature_id)
        if not feature:
            return [], 0
        ids = list(feature.get("matrixIds") or [])
        if matrix_id_list:
            wanted = _csv_set(matrix_id_list)
            ids = [i for i in ids if i in wanted]
        matrices = [self._matrices_by_id[i] for i in ids if i in self._matrices_by_id]
        total = len(matrices)
        if limit <= 0:
            return [], total
        return matrices[skip : skip + limit], total

    def matrices_for_biosample_page(
        self,
        biosample_id: str,
        *,
        filters: Optional[Sequence[Any]] = None,
        matrix_id_list: Optional[str] = None,
        skip: int = 0,
        limit: int = 10,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Fixtures have no expression stats: filter by matrixIDList only."""
        del filters  # no-op; fixtures carry no biosample_expression_stats
        ids = list(self.biosample_matrices.get(biosample_id) or [])
        if matrix_id_list:
            wanted = _csv_set(matrix_id_list)
            ids = [i for i in ids if i in wanted]
        matrices = [self._matrices_by_id[i] for i in ids if i in self._matrices_by_id]
        total = len(matrices)
        if limit <= 0:
            return [], total
        return matrices[skip : skip + limit], total

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
        biosample_filters: Optional[Sequence[Any]] = None,
        feature_filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        from beacon.filters import biosample_matches, feature_doc_matches

        all_feats = self.features_for_matrix(matrix_id)
        if feature_filters:
            all_feats = [
                feat
                for feat in all_feats
                if feature_doc_matches(feat, feature_filters)
            ]
        if feature_id_list:
            allowed = self._resolve_feature_filter_ids(feature_id_list)
            if not allowed:
                return [], 0

            def _feature_hit(feat: Dict[str, Any]) -> bool:
                native = (
                    (feat.get("genomicFeature") or {})
                    .get("featureIdentifier", {})
                    .get("id")
                )
                return feat.get("id") in allowed or (
                    native is not None and native in allowed
                )

            all_feats = [feat for feat in all_feats if _feature_hit(feat)]

        expr_needed = bool(
            biosample_filters
            or biosample_id_list
            or min_value is not None
            or max_value is not None
        )
        if expr_needed:
            allowed_bios: Optional[Set[str]] = None
            if biosample_filters or biosample_id_list:
                bios = self.biosamples_for_matrix(matrix_id)
                if biosample_filters:
                    bios = [
                        sample
                        for sample in bios
                        if biosample_matches(sample, biosample_filters)
                    ]
                allowed_bios = {sample["id"] for sample in bios}
                if biosample_id_list:
                    allowed_bios &= _csv_set(biosample_id_list)
                if not allowed_bios:
                    return [], 0
            expressed: Set[str] = set()
            for ev in self.expression_values:
                if ev.get("matrixId") != matrix_id:
                    continue
                if (
                    allowed_bios is not None
                    and ev.get("biosampleId") not in allowed_bios
                ):
                    continue
                value = ev.get("value")
                if min_value is not None and (
                    value is None or float(value) < min_value
                ):
                    continue
                if max_value is not None and (
                    value is None or float(value) > max_value
                ):
                    continue
                fid = ev.get("featureId")
                if fid:
                    expressed.add(str(fid))
            kept: List[Dict[str, Any]] = []
            for feat in all_feats:
                native = (
                    (feat.get("genomicFeature") or {})
                    .get("featureIdentifier", {})
                    .get("id")
                )
                if feat.get("id") in expressed or (
                    native is not None and str(native) in expressed
                ):
                    kept.append(feat)
            all_feats = kept
        _, order_key = self.effective_axis_sort(
            matrix_id, axis="features", sort=sort, order=order
        )
        reverse = order_key == "desc"
        all_feats = sorted(
            all_feats,
            key=lambda feat: feat.get("id") or "",
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
        filters: Optional[Sequence[Any]] = None,
        feature_id_list: Optional[str] = None,
        biosample_id_list: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        from beacon.filters import biosample_matches

        items = self.biosamples_for_matrix(matrix_id)
        if filters:
            items = [b for b in items if biosample_matches(b, filters)]
        if biosample_id_list:
            wanted = _csv_set(biosample_id_list)
            items = [b for b in items if b.get("id") in wanted]
        if feature_id_list:
            feature_ids = self._resolve_feature_filter_ids(feature_id_list)
            if not feature_ids:
                return [], 0
            expressed = {
                ev.get("biosampleId")
                for ev in self.expression_values
                if ev.get("matrixId") == matrix_id
                and ev.get("featureId") in feature_ids
            }
            items = [b for b in items if b.get("id") in expressed]
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
        biosample_filters: Optional[Sequence[Any]] = None,
        feature_filters: Optional[Sequence[Any]] = None,
        expression_value_filters: Optional[Sequence[Any]] = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        order: Optional[str] = None,
        skip: int = 0,
        limit: Optional[int] = None,
        page_token: Optional[str] = None,
    ):
        """No ID-list caps or combined-rank ordering (removed). Fixtures carry
        no expression stats/percentile parquet, so ``feature_filters`` only
        supports the normal SO/GO/symbol/gene-id feature filters, and a
        percentile ``expression_value_filters`` entry yields an empty page.
        Page tokens here are a simple base64 offset (fixtures-only shortcut).
        """
        import base64

        from beacon.duckdb_store import (
            MAX_PAGE_LIMIT,
            ExpressionValuesPage,
            normalize_expression_value_order,
        )
        from beacon.filters import biosample_matches, feature_doc_matches

        feature_ids = self._resolve_feature_filter_ids(feature_id_list)
        biosample_ids = _csv_set(biosample_id_list)
        if feature_filters:
            matched: Set[str] = set()
            for fid, feat in self._features_by_id.items():
                if not feature_doc_matches(feat, feature_filters):
                    continue
                matched.add(fid)
                native = (
                    (feat.get("genomicFeature") or {})
                    .get("featureIdentifier", {})
                    .get("id")
                )
                if native:
                    matched.add(str(native))
            feature_ids = (feature_ids & matched) if feature_id_list else matched
            if not feature_ids:
                return ExpressionValuesPage([], 0)
        if biosample_filters:
            allowed = {
                b["id"]
                for b in self.biosamples_for_matrix(matrix_id)
                if biosample_matches(b, biosample_filters)
            }
            biosample_ids = biosample_ids & allowed if biosample_ids else allowed
            if not biosample_ids:
                return ExpressionValuesPage([], 0)

        value_filters = []
        for f in expression_value_filters or []:
            if f.id in ("expression.percentileInFeature", "expression.percentileInBiosample"):
                # Fixtures carry no percentile parquet: never matches.
                return ExpressionValuesPage([], 0)
            if f.id == "expression.value":
                value_filters.append(f)

        def _value_filters_match(value: Optional[float]) -> bool:
            for f in value_filters:
                try:
                    fv = float(f.value)
                except (TypeError, ValueError):
                    return False
                if value is None:
                    return False
                op = f.operator or "="
                if op == "=" and value != fv:
                    return False
                if op == "!" and value == fv:
                    return False
                if op == ">" and not (value > fv):
                    return False
                if op == "<" and not (value < fv):
                    return False
                if op == ">=" and not (value >= fv):
                    return False
                if op == "<=" and not (value <= fv):
                    return False
            return True

        out = []
        for ev in self.expression_values:
            if ev.get("matrixId") != matrix_id:
                continue
            if feature_ids and ev.get("featureId") not in feature_ids:
                continue
            if biosample_ids and ev.get("biosampleId") not in biosample_ids:
                continue
            value = ev.get("value")
            if min_value is not None and (value is None or value < min_value):
                continue
            if max_value is not None and (value is None or value > max_value):
                continue
            if value_filters and not _value_filters_match(value):
                continue
            out.append(ev)

        order_key = normalize_expression_value_order(order)
        reverse = order_key == "desc"

        def _value_sort_key(ev: Dict[str, Any]) -> Tuple[Any, ...]:
            v = ev.get("value")
            tie = (str(ev.get("featureId") or ""), str(ev.get("biosampleId") or ""))
            if v is None:
                # Match DuckDB NULLS LAST for both asc and desc.
                return (1, 0.0) + tie
            keyed = -float(v) if reverse else float(v)
            return (0, keyed) + tie

        out = sorted(out, key=_value_sort_key)

        total = len(out)
        limit_v = MAX_PAGE_LIMIT if limit is None else max(0, int(limit))
        skip_v = max(0, int(skip))
        if page_token:
            try:
                padded = page_token + "=" * (-len(page_token) % 4)
                skip_v = max(0, int(base64.urlsafe_b64decode(padded).decode("ascii")))
            except Exception:
                skip_v = max(0, int(skip))
        if limit_v <= 0:
            return ExpressionValuesPage([], total)
        page = out[skip_v : skip_v + limit_v]

        def _encode_skip(value: int) -> str:
            return base64.urlsafe_b64encode(str(value).encode("ascii")).decode(
                "ascii"
            ).rstrip("=")

        next_page = (
            _encode_skip(skip_v + limit_v) if skip_v + len(page) < total else None
        )
        previous_page = (
            _encode_skip(max(0, skip_v - limit_v)) if skip_v > 0 else None
        )
        return ExpressionValuesPage(page, total, next_page, previous_page)

    def _ordered_feature_ids_for_rank(
        self, feature_id_list: Optional[str]
    ) -> List[str]:
        from beacon.duckdb_store import _csv_tokens

        ordered: List[str] = []
        seen: Set[str] = set()
        for token in _csv_tokens(feature_id_list):
            resolved = self._resolve_feature_filter_ids(token)
            preferred = [token] if token in resolved else []
            rest = sorted(fid for fid in resolved if fid not in preferred)
            for fid in preferred + rest:
                if fid in seen:
                    continue
                seen.add(fid)
                ordered.append(fid)
        return ordered

    def _resolve_feature_filter_ids(self, feature_id_list: Optional[str]) -> Set[str]:
        """Accept genomic accessions, symbols, and/or feature wrapper ids."""
        tokens = _csv_set(feature_id_list)
        if not tokens:
            return set()
        resolved: Set[str] = set()
        for token in tokens:
            resolved.add(token)
            resolved.update(self._feature_ids_for_symbol_or_xref(token))
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
