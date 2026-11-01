from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.fixtures import get_store
from beacon.responses import build_filtering_terms_response
from beacon.schemas.envelopes import (
    OPENAPI_BEACON_RESPONSES,
    OPENAPI_FILTERING_TERMS_RESPONSES,
)
from routers.common import empty_entity_response, list_response
from routers.deps import (
    BeaconRequestBody,
    model_to_dict,
    partial_received_for_error,
    resolve_or_error,
)
from routers.filter_helpers import filters_summary, resolve_entity_filters
from routers.request_params import params_from_post, params_summary

router = APIRouter(tags=["Genomic features"])


@router.get("/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_features(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
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
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=filters_summary(filt),
        entity_type="feature",
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
    partial = partial_received_for_error(body=body_dict, entity_type="feature")
    _, perr = params_from_post(body_dict, received=partial)
    if perr:
        return perr
    filt, ferr = resolve_entity_filters(
        entity="feature", body=body_dict, received=partial
    )
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary=filters_summary(filt),
        entity_type="feature",
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


@router.post("/features/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
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


@router.get("/features/{id}/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_feature_matrices(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        entity_type="matrix",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    store = get_store()
    feature = store.get_feature(id)
    if not feature:
        return empty_entity_response("matrix", id, gran, received)
    results = [
        matrix
        for mid in (feature.get("matrixIds") or [])
        if (matrix := store.get_matrix(mid))
    ]
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
    partial = partial_received_for_error(body=body_dict, entity_type="matrix")
    _, perr = params_from_post(body_dict, received=partial)
    if perr:
        return perr
    resolved, err = resolve_or_error(
        body=body_dict, cap_limit=True, entity_type="matrix"
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    store = get_store()
    feature = store.get_feature(id)
    if not feature:
        return empty_entity_response("matrix", id, gran, received)
    results = [
        matrix
        for mid in (feature.get("matrixIds") or [])
        if (matrix := store.get_matrix(mid))
    ]
    return list_response(
        results,
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )
