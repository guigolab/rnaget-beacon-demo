from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.filters import is_matrix_only_expression_filter
from beacon.fixtures import get_store
from beacon.http_cache import RequestTimer, json_with_headers, package_etag
from beacon.responses import error_json
from beacon.schemas.envelopes import OPENAPI_BEACON_RESPONSES
from routers.common import (
    FILTERS_CSV_QUERY_DESCRIPTION,
    empty_entity_response,
    list_response,
)
from routers.deps import (
    BeaconRequestBody,
    model_to_dict,
    partial_received_for_error,
    resolve_or_error,
)
from routers.filter_helpers import (
    filters_summary,
    resolve_entity_filters,
    resolve_feature_matrices_filters,
)
from routers.request_params import params_from_get, params_from_post, params_summary

router = APIRouter(tags=["Genomic features"])


def _reject_matrix_only(filt, received):
    for f in filt or []:
        if is_matrix_only_expression_filter(f):
            return error_json(
                400,
                f"matrix-only expression filter is not valid at root scope: {f.id}",
                received=received,
            )
    return None


_FEATURES_RP = frozenset({"featureIDList"})
# Immutable package → safe short cache for GET probes (nginx + browsers).
_FEATURES_CACHE_CONTROL = "public, max-age=300"


def _features_list_response(
    *,
    skip_v: int,
    limit_v: int,
    gran,
    received,
    filt,
    feature_id_list: Optional[str],
    method: str,
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    timer = RequestTimer()
    timings: Dict[str, float] = {}
    page_limit = limit_v if gran.value == "record" else 0
    results, total = store.list_features_page(
        skip=skip_v,
        limit=page_limit,
        filters=filt or None,
        feature_id_list=feature_id_list,
        timings=timings,
    )
    finished = timer.finish()
    timings.setdefault("total", finished.get("total", 0.0))
    body = list_response(
        results,
        "feature",
        "features",
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )
    # Cache-Control / ETag only on GET (POST probes stay uncached by default).
    if method == "GET":
        return json_with_headers(
            body,
            etag=package_etag(store.package_fingerprint()),
            cache_control=_FEATURES_CACHE_CONTROL,
            timings_ms=timings,
        )
    return json_with_headers(body, timings_ms=timings)


@router.get("/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getFeatures")
def get_features(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None, description=FILTERS_CSV_QUERY_DESCRIPTION),
    featureIDList: Optional[str] = Query(None, description="Comma-separated feature IDs."),
) -> Union[Dict[str, Any], JSONResponse]:
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        entity_type="feature",
    )
    filt, ferr = resolve_entity_filters(
        entity="feature", filters_csv=filters, received=partial
    )
    if ferr:
        return ferr
    rejected = _reject_matrix_only(filt, partial)
    if rejected:
        return rejected
    params, perr = params_from_get(received=partial, featureIDList=featureIDList)
    if perr:
        return perr
    bad_keys = set(params) - _FEATURES_RP
    if bad_keys:
        from beacon.responses import error_json

        return error_json(
            400,
            f"unsupported requestParameters for /features: {', '.join(sorted(bad_keys))}",
            received=partial,
        )
    extra = filters_summary(filt)
    if params:
        extra = {**(extra or {}), "requestParameters": params}
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=extra or None,
        entity_type="feature",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _features_list_response(
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        filt=filt,
        feature_id_list=params.get("featureIDList"),
        method="GET",
    )


@router.post("/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postGenomicFeaturesRequest")
def post_features(
    body: BeaconRequestBody = Body(...),
) -> Union[Dict[str, Any], JSONResponse]:
    body_dict = model_to_dict(body)
    partial = partial_received_for_error(body=body_dict, entity_type="feature")
    params, perr = params_from_post(body_dict, received=partial)
    if perr:
        return perr
    bad_keys = set(params) - _FEATURES_RP
    if bad_keys:
        from beacon.responses import error_json

        return error_json(
            400,
            f"unsupported requestParameters for /features: {', '.join(sorted(bad_keys))}",
            received=partial,
        )
    filt, ferr = resolve_entity_filters(
        entity="feature", body=body_dict, received=partial
    )
    if ferr:
        return ferr
    rejected = _reject_matrix_only(filt, partial)
    if rejected:
        return rejected
    extra = filters_summary(filt)
    if params:
        extra = {**(extra or {}), "requestParameters": params}
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary=extra or None,
        entity_type="feature",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _features_list_response(
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        filt=filt,
        feature_id_list=params.get("featureIDList"),
        method="POST",
    )


@router.get("/features/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getOneFeature")
def get_feature(
    id: str,
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(
        requested_granularity=requestedGranularity,
        entity_type="feature",
    )
    if err:
        return err
    _, _, gran, received = resolved
    item = get_store().get_feature(id)
    if not item:
        return empty_entity_response("feature", id, gran, received)
    return list_response([item], "feature", id, 0, 1, gran, received)


@router.post("/features/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postOneFeature")
def post_feature(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    body_dict = model_to_dict(body)
    partial = partial_received_for_error(body=body_dict, entity_type="feature")
    _, perr = params_from_post(body_dict, received=partial)
    if perr:
        return perr
    resolved, err = resolve_or_error(body=body_dict, entity_type="feature")
    if err:
        return err
    _, _, gran, received = resolved
    item = get_store().get_feature(id)
    if not item:
        return empty_entity_response("feature", id, gran, received)
    return list_response([item], "feature", id, 0, 1, gran, received)


def _feature_matrices_handler(
    id: str,
    *,
    skip_v: int,
    limit_v: int,
    gran,
    received,
    filters,
    matrix_id_list: Optional[str],
):
    store = get_store()
    feature = store.get_feature(id)
    if not feature:
        return empty_entity_response("matrix", id, gran, received)
    page_limit = limit_v if gran.value == "record" else 0
    page_fn = getattr(store, "matrices_for_feature_page", None)
    if callable(page_fn):
        try:
            results, total = page_fn(
                id,
                filters=filters or None,
                matrix_id_list=matrix_id_list,
                skip=skip_v,
                limit=page_limit,
            )
        except ValueError as exc:
            return error_json(400, str(exc), received=received)
    else:
        results = [
            matrix
            for mid in (feature.get("matrixIds") or [])
            if (matrix := store.get_matrix(mid))
        ]
        if matrix_id_list:
            wanted = {p.strip() for p in matrix_id_list.split(",") if p.strip()}
            results = [m for m in results if m.get("id") in wanted]
        total = len(results)
        results = results[skip_v : skip_v + page_limit] if page_limit else []
    return list_response(
        results,
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


@router.get("/features/{id}/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getOneFeatureMatrices")
def get_feature_matrices(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None, description=FILTERS_CSV_QUERY_DESCRIPTION),
    matrixIDList: Optional[str] = Query(
        None, description="RNAget extension: comma-separated matrix IDs."
    ),
) -> Union[Dict[str, Any], JSONResponse]:
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        entity_type="matrix",
    )
    split, ferr = resolve_feature_matrices_filters(
        filters_csv=filters, received=partial
    )
    if ferr:
        return ferr
    feature_filters, matrix_filters = split
    merged = list(feature_filters or []) + list(matrix_filters or [])
    params, perr = params_from_get(received=partial, matrixIDList=matrixIDList)
    if perr:
        return perr
    extra = {
        **(filters_summary(merged) or {}),
        **(params_summary(params) or {}),
    }
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=extra or None,
        entity_type="matrix",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _feature_matrices_handler(
        id,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        filters=merged,
        matrix_id_list=params.get("matrixIDList"),
    )


@router.post("/features/{id}/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postOneFeatureMatrices")
def post_feature_matrices(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    body_dict = model_to_dict(body)
    partial = partial_received_for_error(body=body_dict, entity_type="matrix")
    params, perr = params_from_post(body_dict, received=partial)
    if perr:
        return perr
    split, ferr = resolve_feature_matrices_filters(body=body_dict, received=partial)
    if ferr:
        return ferr
    feature_filters, matrix_filters = split
    merged = list(feature_filters or []) + list(matrix_filters or [])
    extra = {
        **(filters_summary(merged) or {}),
        **(params_summary(params) or {}),
    }
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary=extra or None,
        entity_type="matrix",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _feature_matrices_handler(
        id,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        filters=merged,
        matrix_id_list=params.get("matrixIDList"),
    )
