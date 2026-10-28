from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.fixtures import get_store
from beacon.responses import build_resultsets_response, error_json
from beacon.schemas.envelopes import OPENAPI_BEACON_RESPONSES
from routers.deps import BeaconRequestBody, model_to_dict, resolve_or_error

router = APIRouter(tags=["Biosamples"])


def _list_response(
    results,
    entity_type: str,
    set_id: str,
    skip: int,
    limit: int,
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


@router.get("/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_biosamples(
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
        get_store().list_biosamples(),
        "biosample",
        "biosamples",
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.post("/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_biosamples(
    body: BeaconRequestBody = Body(...),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().list_biosamples(),
        "biosample",
        "biosamples",
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.get("/biosamples/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_biosample(
    id: str,
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_biosample(id)
    if not item:
        return error_json(404, f"Biosample '{id}' not found")
    resolved, err = resolve_or_error(requested_granularity=requestedGranularity)
    if err:
        return err
    _, _, gran, received = resolved
    return _list_response([item], "biosample", id, 0, 1, gran, received)


@router.post("/biosamples/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_biosample(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_biosample(id)
    if not item:
        return error_json(404, f"Biosample '{id}' not found")
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    _, _, gran, received = resolved
    return _list_response([item], "biosample", id, 0, 1, gran, received)


@router.get(
    "/biosamples/{id}/matrices",
    response_model=None,
    responses=OPENAPI_BEACON_RESPONSES,
)
def get_biosample_matrices(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_biosample(id):
        return error_json(404, f"Biosample '{id}' not found")
    resolved, err = resolve_or_error(
        skip=skip, limit=limit, requested_granularity=requestedGranularity
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().matrices_for_biosample(id),
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.post(
    "/biosamples/{id}/matrices",
    response_model=None,
    responses=OPENAPI_BEACON_RESPONSES,
)
def post_biosample_matrices(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_biosample(id):
        return error_json(404, f"Biosample '{id}' not found")
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().matrices_for_biosample(id),
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )
