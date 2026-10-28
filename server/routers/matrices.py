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
from routers.deps import (
    BeaconRequestBody,
    ExpressionValuesRequestBody,
    model_to_dict,
    resolve_or_error,
)

router = APIRouter(tags=["Matrices"])


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


@router.get("/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrices(
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
        get_store().list_matrices(),
        "matrix",
        "matrices",
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.post("/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrices(
    body: BeaconRequestBody = Body(...),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().list_matrices(),
        "matrix",
        "matrices",
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.get("/matrices/filtering_terms", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
@router.post("/matrices/filtering_terms", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def matrices_filtering_terms():
    return build_filtering_terms_response([])


@router.get("/matrices/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix(
    id: str,
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_matrix(id)
    if not item:
        return error_json(404, f"Matrix '{id}' not found")
    resolved, err = resolve_or_error(requested_granularity=requestedGranularity)
    if err:
        return err
    _, _, gran, received = resolved
    return _list_response([item], "matrix", id, 0, 1, gran, received)


@router.post("/matrices/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_matrix(id)
    if not item:
        return error_json(404, f"Matrix '{id}' not found")
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    _, _, gran, received = resolved
    return _list_response([item], "matrix", id, 0, 1, gran, received)


@router.get("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_features(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    resolved, err = resolve_or_error(
        skip=skip, limit=limit, requested_granularity=requestedGranularity
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().features_for_matrix(id),
        "feature",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.post("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_features(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().features_for_matrix(id),
        "feature",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.get("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_biosamples(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    resolved, err = resolve_or_error(
        skip=skip, limit=limit, requested_granularity=requestedGranularity
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().biosamples_for_matrix(id),
        "biosample",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.post("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_biosamples(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    resolved, err = resolve_or_error(body=model_to_dict(body))
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().biosamples_for_matrix(id),
        "biosample",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )


@router.get("/matrices/{id}/expression_values", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_expression_values(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    featureIDList: Optional[str] = Query(None),
    biosampleIDList: Optional[str] = Query(None),
    minValue: Optional[float] = Query(None),
    maxValue: Optional[float] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    extra = {
        "featureIDList": featureIDList,
        "biosampleIDList": biosampleIDList,
        "minValue": minValue,
        "maxValue": maxValue,
    }
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        extra_summary=extra,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    results = get_store().expression_values_for_matrix(
        id,
        feature_id_list=featureIDList,
        biosample_id_list=biosampleIDList,
        min_value=minValue,
        max_value=maxValue,
    )
    return _list_response(results, "expressionValue", id, skip_v, limit_v, gran, received)


@router.post("/matrices/{id}/expression_values", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_expression_values(
    id: str, body: ExpressionValuesRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    payload = model_to_dict(body)
    extra = {
        "featureIDList": body.featureIDList,
        "biosampleIDList": body.biosampleIDList,
        "minValue": body.minValue,
        "maxValue": body.maxValue,
    }
    resolved, err = resolve_or_error(
        skip=body.skip, limit=body.limit, body=payload, extra_summary=extra
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    results = get_store().expression_values_for_matrix(
        id,
        feature_id_list=body.featureIDList,
        biosample_id_list=body.biosampleIDList,
        min_value=body.minValue,
        max_value=body.maxValue,
    )
    return _list_response(results, "expressionValue", id, skip_v, limit_v, gran, received)
