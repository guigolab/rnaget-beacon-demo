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
    coerce_id_list_csv,
    model_to_dict,
    parse_id_list_or_error,
    resolve_or_error,
)
from routers.filter_helpers import filters_summary, resolve_entity_filters

router = APIRouter(tags=["Matrices"])

_ALLOWED_EXPRESSION_GROUP_BY = frozenset({"sex", "condition", "age_bracket", "tissue"})


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
    filters: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    filt, ferr = resolve_entity_filters(entity="matrix", filters_csv=filters)
    if ferr:
        return ferr
    extra = filters_summary(filt)
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=extra,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().list_matrices(filt),
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
    body_dict = model_to_dict(body)
    filt, ferr = resolve_entity_filters(entity="matrix", body=body_dict)
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary=filters_summary(filt),
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    return _list_response(
        get_store().list_matrices(filt),
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
    store = get_store()
    getter = getattr(store, "matrix_filtering_terms", None)
    if callable(getter):
        terms, resources = getter()
        return build_filtering_terms_response(terms, resources)
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
    filters: Optional[str] = Query(None),
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
    filt, ferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if ferr:
        return ferr
    extra = _effective_axis_summary(store, id, axis="features", sort=sort, order=order)
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
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
        biosample_filters=filt,
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
    filt, ferr = resolve_entity_filters(entity="biosample", body=payload)
    if ferr:
        return ferr
    extra = _effective_axis_summary(
        store,
        id,
        axis="features",
        sort=payload.get("sort"),
        order=payload.get("order"),
    )
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
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
        biosample_filters=filt,
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
    filters: Optional[str] = Query(None),
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
    filt, ferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if ferr:
        return ferr
    extra = _effective_axis_summary(
        store, id, axis="biosamples", sort=sort, order=order
    )
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
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
        filters=filt,
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
    filt, ferr = resolve_entity_filters(entity="biosample", body=payload)
    if ferr:
        return ferr
    extra = _effective_axis_summary(
        store,
        id,
        axis="biosamples",
        sort=payload.get("sort"),
        order=payload.get("order"),
    )
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
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
        filters=filt,
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
    filters: Optional[str] = Query(None),
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
    bio_filt, bferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if bferr:
        return bferr
    extra = {
        "featureIDList": featureIDList,
        "biosampleIDList": biosampleIDList,
        "minValue": minValue,
        "maxValue": maxValue,
    }
    if bio_filt:
        extra.update(filters_summary(bio_filt) or {})
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
        biosample_filters=bio_filt,
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
    bio_filt, bferr = resolve_entity_filters(entity="biosample", body=payload)
    if bferr:
        return bferr
    feature_csv = coerce_id_list_csv(body.featureIDList)
    biosample_csv = coerce_id_list_csv(body.biosampleIDList)
    extra = {
        "featureIDList": feature_csv,
        "biosampleIDList": biosample_csv,
        "minValue": body.minValue,
        "maxValue": body.maxValue,
    }
    if bio_filt:
        extra.update(filters_summary(bio_filt) or {})
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
        feature_id_list=feature_csv,
        biosample_id_list=biosample_csv,
        biosample_filters=bio_filt,
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


def _matrix_expression_summary_response(
    id: str,
    *,
    feat_csv: Optional[str],
    group: Optional[str],
    thr: Optional[float],
    bio_filt,
    gran,
    received,
):
    store = get_store()
    getter = getattr(store, "expression_summary_for_matrix", None)
    if not callable(getter):
        return error_json(501, "expression_summary not available")
    results = getter(
        id,
        feature_id_list=feat_csv,
        group_by=group,
        biosample_filters=bio_filt,
        threshold=thr,
    )
    return _list_response(
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


@router.get(
    "/matrices/{id}/expression_summary",
    response_model=None,
    responses=OPENAPI_BEACON_RESPONSES,
)
def get_matrix_expression_summary(
    id: str,
    featureIDList: Optional[str] = Query(None),
    groupBy: Optional[str] = Query(None),
    threshold: Optional[float] = Query(None),
    filters: Optional[str] = Query(None),
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    if groupBy and groupBy not in _ALLOWED_EXPRESSION_GROUP_BY:
        return error_json(
            400,
            f"unsupported groupBy {groupBy!r}; allowed: {sorted(_ALLOWED_EXPRESSION_GROUP_BY)}",
        )
    bio_filt, bferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if bferr:
        return bferr
    extra = {"featureIDList": featureIDList, "groupBy": groupBy, "threshold": threshold}
    if bio_filt:
        extra.update(filters_summary(bio_filt) or {})
    resolved, err = resolve_or_error(
        requested_granularity=requestedGranularity,
        extra_summary=extra,
    )
    if err:
        return err
    _, _, gran, received = resolved
    return _matrix_expression_summary_response(
        id,
        feat_csv=featureIDList,
        group=groupBy,
        thr=threshold,
        bio_filt=bio_filt,
        gran=gran,
        received=received,
    )


@router.post(
    "/matrices/{id}/expression_summary",
    response_model=None,
    responses=OPENAPI_BEACON_RESPONSES,
)
def post_matrix_expression_summary(
    id: str,
    body: ExpressionValuesRequestBody = Body(...),
) -> Union[Dict[str, Any], JSONResponse]:
    if not get_store().get_matrix(id):
        return error_json(404, f"Matrix '{id}' not found")
    payload = model_to_dict(body)
    if body.groupBy and body.groupBy not in _ALLOWED_EXPRESSION_GROUP_BY:
        return error_json(
            400,
            f"unsupported groupBy {body.groupBy!r}; allowed: {sorted(_ALLOWED_EXPRESSION_GROUP_BY)}",
        )
    bio_filt, bferr = resolve_entity_filters(entity="biosample", body=payload)
    if bferr:
        return bferr
    feat_csv = coerce_id_list_csv(body.featureIDList)
    extra = {
        "featureIDList": feat_csv,
        "groupBy": body.groupBy,
        "threshold": body.threshold,
    }
    if bio_filt:
        extra.update(filters_summary(bio_filt) or {})
    resolved, err = resolve_or_error(body=payload, extra_summary=extra)
    if err:
        return err
    _, _, gran, received = resolved
    return _matrix_expression_summary_response(
        id,
        feat_csv=feat_csv,
        group=body.groupBy,
        thr=body.threshold,
        bio_filt=bio_filt,
        gran=gran,
        received=received,
    )
