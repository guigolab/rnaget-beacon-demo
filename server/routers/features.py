from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.fixtures import get_store
from beacon.responses import (
    build_filtering_terms_response,
    build_resultsets_response,
    error_json,
)
from beacon.schemas.envelopes import OPENAPI_BEACON_RESPONSES
from routers.deps import BeaconRequestBody, model_to_dict, resolve_or_error

router = APIRouter(tags=["Genomic features"])


def _list_response(
    results,
    entity_type,
    set_id,
    skip,
    limit,
    granularity,
    received: Optional[Dict[str, Any]] = None,
):
    return build_resultsets_response(
        entity_type=entity_type,
        results=results,
        set_id=set_id,
        granularity=granularity,
        skip=skip,
        limit=limit,
        received=received,
    )


@router.get("/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_features(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(
        skip=skip, limit=limit, requested_granularity=requestedGranularity
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().list_features(),
        "feature",
        "features",
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.post("/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_features(
    body: BeaconRequestBody = Body(...),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().list_features(),
        "feature",
        "features",
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.get("/features/filtering_terms", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
@router.post("/features/filtering_terms", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def features_filtering_terms():
    return build_filtering_terms_response([])


@router.get("/features/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_feature(
    id: str,
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_feature(id)
    if not item:
        return error_json(404, f"Feature '{id}' not found")
    resolved, err = resolve_or_error(requested_granularity=requestedGranularity)
    if err:
        return err
    _, _, gran, received = resolved
    return _list_response([item], "feature", id, 0, 1, gran, received)


@router.post("/features/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_feature(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_feature(id)
    if not item:
        return error_json(404, f"Feature '{id}' not found")
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    _, _, gran, received = resolved
    return _list_response([item], "feature", id, 0, 1, gran, received)


@router.get("/features/{id}/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_feature_matrices(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_feature(id):
        return error_json(404, f"Feature '{id}' not found")
    resolved, err = resolve_or_error(
        skip=skip, limit=limit, requested_granularity=requestedGranularity
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().matrices_for_feature(id),
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
    if not get_store().get_feature(id):
        return error_json(404, f"Feature '{id}' not found")
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().matrices_for_feature(id),
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )
