from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.fixtures import get_store
from beacon.responses import build_filtering_terms_response, error_json
from beacon.schemas.envelopes import (
    OPENAPI_BEACON_RESPONSES,
    OPENAPI_FILTERING_TERMS_RESPONSES,
)
from routers.common import empty_entity_response, list_response
from routers.deps import BeaconRequestBody, model_to_dict, resolve_or_error
from routers.filter_helpers import filters_summary, resolve_entity_filters
from routers.request_params import params_from_post, params_summary

router = APIRouter(tags=["Genomic features"])


@router.get("/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_features(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    filt, ferr = resolve_entity_filters(entity="feature", filters_csv=filters)
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary={"filters": filters_summary(filt)} if filt else None,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().list_features_page(
        skip=skip_v, limit=page_limit, filters=filt or None
    )
    return list_response(
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


@router.post("/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_features(
    body: BeaconRequestBody = Body(...),
) -> Union[Dict[str, Any], JSONResponse]:
    body_dict = model_to_dict(body)
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
    filt, ferr = resolve_entity_filters(entity="feature", body=body_dict)
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary={"filters": filters_summary(filt)} if filt else None,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().list_features_page(
        skip=skip_v, limit=page_limit, filters=filt or None
    )
    return list_response(
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


@router.get(
    "/features/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
@router.post(
    "/features/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
def features_filtering_terms():
    terms, resources = get_store().filtering_terms(scopes=["genomicFeature"])
    return build_filtering_terms_response(terms, resources)


@router.get("/features/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_feature(
    id: str,
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_feature(id)
    resolved, err = resolve_or_error(requested_granularity=requestedGranularity)
    if err:
        return err
    _, _, gran, received = resolved
    if not item:
        return empty_entity_response("feature", id, gran, received)
    return list_response([item], "feature", id, 0, 1, gran, received)


@router.post("/features/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_feature(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_feature(id)
    body_dict = model_to_dict(body)
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
    resolved, err = resolve_or_error(body=body_dict)
    if err:
        return err
    _, _, gran, received = resolved
    if not item:
        return empty_entity_response("feature", id, gran, received)
    return list_response([item], "feature", id, 0, 1, gran, received)


@router.get("/features/{id}/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_feature_matrices(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_feature(id):
        return empty_entity_response("matrix", id, gran, received)
    results = get_store().matrices_for_feature(id)
    return list_response(
        results,
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.post("/features/{id}/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_feature_matrices(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    body_dict = model_to_dict(body)
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
    resolved, err = resolve_or_error(body=body_dict, cap_limit=True)
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_feature(id):
        return empty_entity_response("matrix", id, gran, received)
    results = get_store().matrices_for_feature(id)
    return list_response(
        results,
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.get(
    "/features/{id}/expression_summary",
    response_model=None,
    responses=OPENAPI_BEACON_RESPONSES,
)
def get_feature_expression_summary(
    id: str,
    threshold: Optional[float] = Query(None),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    resolved, err = resolve_or_error(
        requested_granularity=requestedGranularity,
        extra_summary={"threshold": threshold} if threshold is not None else None,
    )
    if err:
        return err
    _, _, gran, received = resolved
    if not store.get_feature(id):
        return empty_entity_response("expressionSummary", id, gran, received)
    getter = getattr(store, "expression_summary_for_feature", None)
    if not callable(getter):
        return error_json(501, "expression_summary not available")
    results = getter(id, threshold=threshold)
    if gran.value != "record":
        return list_response(
            [],
            "expressionSummary",
            id,
            0,
            1,
            gran,
            received,
            total_count=len(results),
            results_are_page=True,
        )
    return list_response(
        results,
        "expressionSummary",
        id,
        0,
        max(len(results), 1),
        gran,
        received,
        total_count=len(results),
        results_are_page=True,
    )


@router.post(
    "/features/{id}/expression_summary",
    response_model=None,
    responses=OPENAPI_BEACON_RESPONSES,
)
def post_feature_expression_summary(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    payload = model_to_dict(body)
    params, perr = params_from_post(payload)
    if perr:
        return perr
    thr = params.get("threshold")
    extra = params_summary(params) or None
    if thr is not None and extra is None:
        extra = {"threshold": thr}
    elif extra and thr is not None:
        extra = {**extra, "threshold": thr}
    resolved, err = resolve_or_error(body=payload, extra_summary=extra)
    if err:
        return err
    _, _, gran, received = resolved
    if not store.get_feature(id):
        return empty_entity_response("expressionSummary", id, gran, received)
    getter = getattr(store, "expression_summary_for_feature", None)
    if not callable(getter):
        return error_json(501, "expression_summary not available")
    results = getter(id, threshold=float(thr) if thr is not None else None)
    if gran.value != "record":
        return list_response(
            [],
            "expressionSummary",
            id,
            0,
            1,
            gran,
            received,
            total_count=len(results),
            results_are_page=True,
        )
    return list_response(
        results,
        "expressionSummary",
        id,
        0,
        max(len(results), 1),
        gran,
        received,
        total_count=len(results),
        results_are_page=True,
    )
