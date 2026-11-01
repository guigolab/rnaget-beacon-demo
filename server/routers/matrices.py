from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.fixtures import get_store
from beacon.responses import (
    build_filtering_terms_response,
    build_resultsets_response,
    error_json,
)
from beacon.schemas.envelopes import (
    OPENAPI_BEACON_RESPONSES,
    OPENAPI_FILTERING_TERMS_RESPONSES,
)
from routers.deps import (
    AxisOrder,
    AxisSort,
    BeaconRequestBody,
    ExpressionValuesRequestBody,
    MatrixAxisRequestBody,
    axis_order_value,
    axis_sort_value,
    model_to_dict,
    parse_id_list_or_error,
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
    *,
    total_count: Optional[int] = None,
    results_are_page: bool = False,
):
    return build_resultsets_response(
        entity_type=entity_type,
        results=results,
        set_id=set_id,
        granularity=granularity,
        skip=skip,
        limit=limit,
        received=received,
        total_count=total_count,
        results_are_page=results_are_page,
    )


@router.get("/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrices(
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
    resolved, err = resolve_or_error(body=model_to_dict(body), cap_limit=True)
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


@router.get(
    "/matrices/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
@router.post(
    "/matrices/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
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


def _effective_axis_summary(
    store: Any,
    matrix_id: str,
    *,
    axis: str,
    sort: Any,
    order: Any,
) -> Dict[str, str]:
    """Normalize requested sort/order to what the store will actually apply."""
    sort_req = axis_sort_value(sort)
    order_req = axis_order_value(order)
    effective = getattr(store, "effective_axis_sort", None)
    if callable(effective):
        sort_v, order_v = effective(
            matrix_id, axis=axis, sort=sort_req, order=order_req
        )
    else:
        sort_v, order_v = sort_req, order_req
    return {"sort": sort_v, "order": order_v}


@router.get("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_features(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    sort: AxisSort = Query(
        AxisSort.id,
        description="Sort key: id | expression.min | expression.max",
    ),
    order: AxisOrder = Query(
        AxisOrder.asc,
        description="Sort direction: asc | desc",
    ),
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    if not store.get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    extra = _effective_axis_summary(store, id, axis="features", sort=sort, order=order)
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        extra_summary=extra,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = store.features_for_matrix_page(
        id,
        skip=skip_v,
        limit=page_limit,
        sort=extra["sort"],
        order=extra["order"],
    )
    return _list_response(
        results,
        "feature",
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


@router.post("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_features(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    if not store.get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    payload = model_to_dict(body)
    extra = _effective_axis_summary(
        store,
        id,
        axis="features",
        sort=payload.get("sort"),
        order=payload.get("order"),
    )
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = store.features_for_matrix_page(
        id,
        skip=skip_v,
        limit=page_limit,
        sort=extra["sort"],
        order=extra["order"],
    )
    return _list_response(
        results,
        "feature",
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


@router.get("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_biosamples(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    sort: AxisSort = Query(
        AxisSort.id,
        description="Sort key: id | expression.min | expression.max",
    ),
    order: AxisOrder = Query(
        AxisOrder.asc,
        description="Sort direction: asc | desc",
    ),
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    if not store.get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    extra = _effective_axis_summary(
        store, id, axis="biosamples", sort=sort, order=order
    )
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        extra_summary=extra,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = store.biosamples_for_matrix_page(
        id,
        skip=skip_v,
        limit=page_limit,
        sort=extra["sort"],
        order=extra["order"],
    )
    return _list_response(
        results,
        "biosample",
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


@router.post("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_biosamples(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    if not store.get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    payload = model_to_dict(body)
    extra = _effective_axis_summary(
        store,
        id,
        axis="biosamples",
        sort=payload.get("sort"),
        order=payload.get("order"),
    )
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = store.biosamples_for_matrix_page(
        id,
        skip=skip_v,
        limit=page_limit,
        sort=extra["sort"],
        order=extra["order"],
    )
    return _list_response(
        results,
        "biosample",
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
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
    featureIDList, ferr = parse_id_list_or_error(featureIDList)
    if ferr:
        return ferr
    biosampleIDList, berr = parse_id_list_or_error(biosampleIDList)
    if berr:
        return berr
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
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().expression_values_for_matrix(
        id,
        feature_id_list=featureIDList,
        biosample_id_list=biosampleIDList,
        min_value=minValue,
        max_value=maxValue,
        skip=skip_v,
        limit=page_limit,
    )
    return _list_response(
        results,
        "expressionValue",
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


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
        skip=body.skip,
        limit=body.limit,
        body=payload,
        extra_summary=extra,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().expression_values_for_matrix(
        id,
        feature_id_list=body.featureIDList,
        biosample_id_list=body.biosampleIDList,
        min_value=body.minValue,
        max_value=body.maxValue,
        skip=skip_v,
        limit=page_limit,
    )
    return _list_response(
        results,
        "expressionValue",
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )
