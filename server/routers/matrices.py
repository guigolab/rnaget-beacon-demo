from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.fixtures import get_store
from beacon.responses import (
    build_filtering_terms_response,
    error_json,
)
from beacon.schemas.envelopes import (
    OPENAPI_BEACON_RESPONSES,
    OPENAPI_FILTERING_TERMS_RESPONSES,
)
from routers.common import empty_entity_response, list_response
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
from routers.filter_helpers import filters_summary, resolve_entity_filters
from routers.request_params import params_from_get, params_from_post, params_summary

router = APIRouter(tags=["Matrices"])

_ALLOWED_EXPRESSION_GROUP_BY = frozenset(
    {
        "sex",
        "condition",
        "age_bracket",
        "tissue",
        "biosampleStatus",
        "phenotype",
    }
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
    return list_response(
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
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
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
    return list_response(
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
    resolved, err = resolve_or_error(requested_granularity=requestedGranularity)
    if err:
        return err
    _, _, gran, received = resolved
    if not item:
        return empty_entity_response("matrix", id, gran, received)
    return list_response([item], "matrix", id, 0, 1, gran, received)


@router.post("/matrices/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_matrix(id)
    body_dict = model_to_dict(body)
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
    resolved, err = resolve_or_error(body=body_dict)
    if err:
        return err
    _, _, gran, received = resolved
    if not item:
        return empty_entity_response("matrix", id, gran, received)
    return list_response([item], "matrix", id, 0, 1, gran, received)


def _effective_axis_summary(
    store: Any,
    matrix_id: str,
    *,
    axis: str,
    sort: Any,
    order: Any,
) -> Dict[str, str]:
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


def _matrix_axis_list(
    id: str,
    *,
    axis: str,
    entity_type: str,
    filt,
    skip_v: int,
    limit_v: int,
    gran,
    received,
    sort: str,
    order: str,
    biosample_filters=None,
):
    store = get_store()
    page_limit = limit_v if gran.value == "record" else 0
    if axis == "features":
        results, total = store.features_for_matrix_page(
            id,
            skip=skip_v,
            limit=page_limit,
            sort=sort,
            order=order,
            biosample_filters=biosample_filters or filt,
        )
    else:
        results, total = store.biosamples_for_matrix_page(
            id,
            skip=skip_v,
            limit=page_limit,
            sort=sort,
            order=order,
            filters=filt,
        )
    return list_response(
        results,
        entity_type,
        id,
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


@router.get("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_features(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
    sort: AxisSort = Query(AxisSort.id),
    order: AxisOrder = Query(AxisOrder.asc),
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not store.get_matrix(id):
        return empty_entity_response("feature", id, gran, received)
    filt, ferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if ferr:
        return ferr
    extra = _effective_axis_summary(store, id, axis="features", sort=sort, order=order)
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
    received = {**received, **{k: v for k, v in extra.items() if v}}
    return _matrix_axis_list(
        id,
        axis="features",
        entity_type="feature",
        filt=filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        sort=extra["sort"],
        order=extra["order"],
        biosample_filters=filt,
    )


@router.post("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_features(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    payload = model_to_dict(body)
    params, perr = params_from_post(payload)
    if perr:
        return perr
    filt, ferr = resolve_entity_filters(entity="biosample", body=payload)
    if ferr:
        return ferr
    extra = _effective_axis_summary(
        store,
        id,
        axis="features",
        sort=params.get("sort"),
        order=params.get("order"),
    )
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
    rp = params_summary(params)
    if rp:
        extra = {**extra, **rp}
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not store.get_matrix(id):
        return empty_entity_response("feature", id, gran, received)
    return _matrix_axis_list(
        id,
        axis="features",
        entity_type="feature",
        filt=filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        sort=extra["sort"],
        order=extra["order"],
        biosample_filters=filt,
    )


@router.get("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_biosamples(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
    sort: AxisSort = Query(AxisSort.id),
    order: AxisOrder = Query(AxisOrder.asc),
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not store.get_matrix(id):
        return empty_entity_response("biosample", id, gran, received)
    filt, ferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if ferr:
        return ferr
    extra = _effective_axis_summary(
        store, id, axis="biosamples", sort=sort, order=order
    )
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
    received = {**received, **{k: v for k, v in extra.items() if v}}
    return _matrix_axis_list(
        id,
        axis="biosamples",
        entity_type="biosample",
        filt=filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        sort=extra["sort"],
        order=extra["order"],
    )


@router.post("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_biosamples(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    payload = model_to_dict(body)
    params, perr = params_from_post(payload)
    if perr:
        return perr
    filt, ferr = resolve_entity_filters(entity="biosample", body=payload)
    if ferr:
        return ferr
    extra = _effective_axis_summary(
        store,
        id,
        axis="biosamples",
        sort=params.get("sort"),
        order=params.get("order"),
    )
    if filt:
        extra = {**extra, **(filters_summary(filt) or {})}
    rp = params_summary(params)
    if rp:
        extra = {**extra, **rp}
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not store.get_matrix(id):
        return empty_entity_response("biosample", id, gran, received)
    return _matrix_axis_list(
        id,
        axis="biosamples",
        entity_type="biosample",
        filt=filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        sort=extra["sort"],
        order=extra["order"],
    )


def _expression_values_handler(
    id: str,
    *,
    params: Dict[str, Any],
    bio_filt,
    skip_v: int,
    limit_v: int,
    gran,
    received,
):
    feature_csv = params.get("featureIDList")
    biosample_csv = params.get("biosampleIDList")
    min_value = params.get("minValue")
    max_value = params.get("maxValue")
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().expression_values_for_matrix(
        id,
        feature_id_list=feature_csv,
        biosample_id_list=biosample_csv,
        biosample_filters=bio_filt,
        min_value=min_value,
        max_value=max_value,
        skip=skip_v,
        limit=page_limit,
    )
    return list_response(
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
    params, perr = params_from_get(
        featureIDList=featureIDList,
        biosampleIDList=biosampleIDList,
        minValue=minValue,
        maxValue=maxValue,
    )
    if perr:
        return perr
    if featureIDList:
        featureIDList, ferr = parse_id_list_or_error(featureIDList)
        if ferr:
            return ferr
        params["featureIDList"] = featureIDList
    if biosampleIDList:
        biosampleIDList, berr = parse_id_list_or_error(biosampleIDList)
        if berr:
            return berr
        params["biosampleIDList"] = biosampleIDList
    bio_filt, bferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if bferr:
        return bferr
    extra = {**params_summary(params), **(filters_summary(bio_filt) or {})}
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        extra_summary=extra or None,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_matrix(id):
        return empty_entity_response("expressionValue", id, gran, received)
    return _expression_values_handler(
        id,
        params=params,
        bio_filt=bio_filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
    )


@router.post("/matrices/{id}/expression_values", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_expression_values(
    id: str, body: ExpressionValuesRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    payload = model_to_dict(body)
    params, perr = params_from_post(payload)
    if perr:
        return perr
    bio_filt, bferr = resolve_entity_filters(entity="biosample", body=payload)
    if bferr:
        return bferr
    extra = {**params_summary(params), **(filters_summary(bio_filt) or {})}
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra or None,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_matrix(id):
        return empty_entity_response("expressionValue", id, gran, received)
    return _expression_values_handler(
        id,
        params=params,
        bio_filt=bio_filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
    )


def _matrix_expression_summary_response(
    id: str,
    *,
    params: Dict[str, Any],
    bio_filt,
    gran,
    received,
):
    store = get_store()
    getter = getattr(store, "expression_summary_for_matrix", None)
    if not callable(getter):
        return error_json(501, "expression_summary not available")
    group = params.get("groupBy")
    if group and group not in _ALLOWED_EXPRESSION_GROUP_BY:
        return error_json(
            400,
            f"unsupported groupBy {group!r}; allowed: {sorted(_ALLOWED_EXPRESSION_GROUP_BY)}",
        )
    results = getter(
        id,
        feature_id_list=params.get("featureIDList"),
        group_by=group,
        biosample_filters=bio_filt,
        threshold=params.get("threshold"),
    )
    if gran.value != "record":
        total = len(results)
        return list_response(
            [],
            "expressionSummary",
            id,
            0,
            1,
            gran,
            received,
            total_count=total,
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
    params, perr = params_from_get(
        featureIDList=featureIDList,
        groupBy=groupBy,
        threshold=threshold,
    )
    if perr:
        return perr
    if groupBy and groupBy not in _ALLOWED_EXPRESSION_GROUP_BY:
        return error_json(
            400,
            f"unsupported groupBy {groupBy!r}; allowed: {sorted(_ALLOWED_EXPRESSION_GROUP_BY)}",
        )
    bio_filt, bferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if bferr:
        return bferr
    extra = {**params_summary(params), **(filters_summary(bio_filt) or {})}
    resolved, err = resolve_or_error(
        requested_granularity=requestedGranularity,
        extra_summary=extra or None,
    )
    if err:
        return err
    _, _, gran, received = resolved
    if not get_store().get_matrix(id):
        return empty_entity_response("expressionSummary", id, gran, received)
    return _matrix_expression_summary_response(
        id, params=params, bio_filt=bio_filt, gran=gran, received=received
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
    payload = model_to_dict(body)
    params, perr = params_from_post(payload)
    if perr:
        return perr
    group = params.get("groupBy")
    if group and group not in _ALLOWED_EXPRESSION_GROUP_BY:
        return error_json(
            400,
            f"unsupported groupBy {group!r}; allowed: {sorted(_ALLOWED_EXPRESSION_GROUP_BY)}",
        )
    bio_filt, bferr = resolve_entity_filters(entity="biosample", body=payload)
    if bferr:
        return bferr
    extra = {**params_summary(params), **(filters_summary(bio_filt) or {})}
    resolved, err = resolve_or_error(body=payload, extra_summary=extra or None)
    if err:
        return err
    _, _, gran, received = resolved
    if not get_store().get_matrix(id):
        return empty_entity_response("expressionSummary", id, gran, received)
    return _matrix_expression_summary_response(
        id, params=params, bio_filt=bio_filt, gran=gran, received=received
    )
