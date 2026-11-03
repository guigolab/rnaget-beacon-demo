from typing import Any, Dict, List, Optional, Set, Union

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
    ExpressionValueSort,
    ExpressionValuesRequestBody,
    MatrixAxisRequestBody,
    axis_order_value,
    axis_sort_value,
    expression_value_sort_value,
    model_to_dict,
    parse_id_list_or_error,
    partial_received_for_error,
    resolve_or_error,
)
from routers.filter_helpers import (
    filters_summary,
    resolve_entity_filters,
    resolve_expression_value_filters,
    resolve_matrix_feature_axis_filters,
)
from routers.request_params import params_from_get, params_from_post, params_summary

router = APIRouter(tags=["Matrices"])


@router.get("/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrices(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        entity_type="matrix",
    )
    filt, ferr = resolve_entity_filters(
        entity="matrix", filters_csv=filters, received=partial
    )
    if ferr:
        return ferr
    extra = filters_summary(filt)
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=extra,
        entity_type="matrix",
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
    partial = partial_received_for_error(body=body_dict, entity_type="matrix")
    _, perr = params_from_post(body_dict, received=partial)
    if perr:
        return perr
    filt, ferr = resolve_entity_filters(
        entity="matrix", body=body_dict, received=partial
    )
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary=filters_summary(filt),
        entity_type="matrix",
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


@router.get("/matrices/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix(
    id: str,
    requestedGranularity: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    resolved, err = resolve_or_error(
        requested_granularity=requestedGranularity,
        entity_type="matrix",
    )
    if err:
        return err
    _, _, gran, received = resolved
    item = get_store().get_matrix(id)
    if not item:
        return empty_entity_response("matrix", id, gran, received)
    return list_response([item], "matrix", id, 0, 1, gran, received)


@router.post("/matrices/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    body_dict = model_to_dict(body)
    partial = partial_received_for_error(body=body_dict, entity_type="matrix")
    _, perr = params_from_post(body_dict, received=partial)
    if perr:
        return perr
    resolved, err = resolve_or_error(body=body_dict, entity_type="matrix")
    if err:
        return err
    _, _, gran, received = resolved
    item = get_store().get_matrix(id)
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


def _reject_inverted_range(params: Dict[str, Any], received):
    min_value = params.get("minValue")
    max_value = params.get("maxValue")
    if (
        min_value is not None
        and max_value is not None
        and float(min_value) > float(max_value)
    ):
        return error_json(
            400,
            "minValue must be less than or equal to maxValue",
            received=received,
        )
    return None


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
    feature_filters=None,
    feature_id_list: Optional[str] = None,
    biosample_id_list: Optional[str] = None,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
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
            biosample_filters=biosample_filters if biosample_filters is not None else filt,
            feature_filters=feature_filters,
            feature_id_list=feature_id_list,
            biosample_id_list=biosample_id_list,
            min_value=min_value,
            max_value=max_value,
        )
    else:
        results, total = store.biosamples_for_matrix_page(
            id,
            skip=skip_v,
            limit=page_limit,
            sort=sort,
            order=order,
            filters=filt,
            feature_id_list=feature_id_list,
            biosample_id_list=biosample_id_list,
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


def _feature_axis_extra(store: Any, matrix_id: str, params: Dict[str, Any], feature_filters, biosample_filters):
    extra = _effective_axis_summary(
        store,
        matrix_id,
        axis="features",
        sort=params.get("sort"),
        order=params.get("order"),
    )
    merged = list(feature_filters or []) + list(biosample_filters or [])
    if merged:
        extra = {**extra, **(filters_summary(merged) or {})}
    rp = params_summary(params)
    if rp:
        extra = {**extra, **rp}
    return extra


@router.get("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_features(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
    sort: AxisSort = Query(AxisSort.id),
    order: AxisOrder = Query(AxisOrder.asc),
    featureIDList: Optional[str] = Query(None),
    biosampleIDList: Optional[str] = Query(None),
    minValue: Optional[float] = Query(None),
    maxValue: Optional[float] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        entity_type="feature",
    )
    split, ferr = resolve_matrix_feature_axis_filters(
        filters_csv=filters, received=partial
    )
    if ferr:
        return ferr
    feature_filters, biosample_filters = split
    params, perr = params_from_get(
        received=partial,
        featureIDList=featureIDList,
        biosampleIDList=biosampleIDList,
        minValue=minValue,
        maxValue=maxValue,
        sort=axis_sort_value(sort),
        order=axis_order_value(order),
    )
    if perr:
        return perr
    inverted = _reject_inverted_range(params, partial)
    if inverted:
        return inverted
    extra = _feature_axis_extra(
        store, id, params, feature_filters, biosample_filters
    )
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=extra,
        entity_type="feature",
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
        filt=biosample_filters,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        sort=extra["sort"],
        order=extra["order"],
        biosample_filters=biosample_filters,
        feature_filters=feature_filters,
        feature_id_list=params.get("featureIDList"),
        biosample_id_list=params.get("biosampleIDList"),
        min_value=params.get("minValue"),
        max_value=params.get("maxValue"),
    )


@router.post("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_features(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    payload = model_to_dict(body)
    partial = partial_received_for_error(body=payload, entity_type="feature")
    params, perr = params_from_post(payload, received=partial)
    if perr:
        return perr
    split, ferr = resolve_matrix_feature_axis_filters(
        body=payload, received=partial
    )
    if ferr:
        return ferr
    feature_filters, biosample_filters = split
    inverted = _reject_inverted_range(params, partial)
    if inverted:
        return inverted
    extra = _feature_axis_extra(
        store, id, params, feature_filters, biosample_filters
    )
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra,
        cap_limit=True,
        entity_type="feature",
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
        filt=biosample_filters,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        sort=extra["sort"],
        order=extra["order"],
        biosample_filters=biosample_filters,
        feature_filters=feature_filters,
        feature_id_list=params.get("featureIDList"),
        biosample_id_list=params.get("biosampleIDList"),
        min_value=params.get("minValue"),
        max_value=params.get("maxValue"),
    )


@router.get(
    "/matrices/{id}/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
@router.post(
    "/matrices/{id}/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
def matrix_scoped_filtering_terms(id: str):
    store = get_store()
    if not store.get_matrix(id):
        return build_filtering_terms_response([])
    getter = getattr(store, "matrix_scoped_filtering_terms", None)
    if callable(getter):
        terms, resources = getter(id)
        return build_filtering_terms_response(terms, resources)
    return build_filtering_terms_response([])


@router.get("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_matrix_biosamples(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
    sort: AxisSort = Query(AxisSort.id),
    order: AxisOrder = Query(AxisOrder.asc),
    featureIDList: Optional[str] = Query(None),
    biosampleIDList: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        entity_type="biosample",
    )
    filt, ferr = resolve_entity_filters(
        entity="biosample", filters_csv=filters, received=partial
    )
    if ferr:
        return ferr
    params, perr = params_from_get(
        received=partial,
        featureIDList=featureIDList,
        biosampleIDList=biosampleIDList,
        sort=axis_sort_value(sort),
        order=axis_order_value(order),
    )
    if perr:
        return perr
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
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=extra,
        entity_type="biosample",
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
        feature_id_list=params.get("featureIDList"),
        biosample_id_list=params.get("biosampleIDList"),
    )


@router.post("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_matrix_biosamples(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    payload = model_to_dict(body)
    partial = partial_received_for_error(body=payload, entity_type="biosample")
    params, perr = params_from_post(payload, received=partial)
    if perr:
        return perr
    filt, ferr = resolve_entity_filters(
        entity="biosample", body=payload, received=partial
    )
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
        entity_type="biosample",
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
        feature_id_list=params.get("featureIDList"),
        biosample_id_list=params.get("biosampleIDList"),
    )


def _expression_values_page_axes(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Unique feature/biosample ids in page order (Beacon ``info.axes`` extension)."""
    feature_ids: List[str] = []
    biosample_ids: List[str] = []
    seen_features: Set[str] = set()
    seen_biosamples: Set[str] = set()
    for row in results:
        feature_id = row.get("featureId")
        if feature_id is not None:
            key = str(feature_id)
            if key not in seen_features:
                seen_features.add(key)
                feature_ids.append(key)
        biosample_id = row.get("biosampleId")
        if biosample_id is not None:
            key = str(biosample_id)
            if key not in seen_biosamples:
                seen_biosamples.add(key)
                biosample_ids.append(key)
    return {
        "axes": {
            "featureIds": feature_ids,
            "biosampleIds": biosample_ids,
        }
    }


def _page_token_from_request(
    *,
    page_token: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Prefer explicit GET ``pageToken``; else POST pagination next/previousPage."""
    if page_token:
        return str(page_token)
    query = (body or {}).get("query") or {}
    pagination = query.get("pagination") or {}
    if not isinstance(pagination, dict):
        return None
    # Prefer a single navigation token over currentPage (which would stall if
    # the client echoes the whole pagination object). If both next and previous
    # are set, prefer previous only when next is absent — otherwise nextPage.
    prev = pagination.get("previousPage")
    nxt = pagination.get("nextPage")
    if nxt and not prev:
        return str(nxt)
    if prev and not nxt:
        return str(prev)
    if nxt:
        return str(nxt)
    if prev:
        return str(prev)
    cur = pagination.get("currentPage")
    return str(cur) if cur else None


def _expression_values_handler(
    id: str,
    *,
    params: Dict[str, Any],
    feature_filt,
    bio_filt,
    expr_filt,
    skip_v: int,
    limit_v: int,
    gran,
    received,
    page_token: Optional[str] = None,
):
    """Expression values retrieval (ID lists / filters / value page)."""
    feature_csv = params.get("featureIDList")
    biosample_csv = params.get("biosampleIDList")
    min_value = params.get("minValue")
    max_value = params.get("maxValue")
    page_limit = limit_v if gran.value == "record" else 0
    try:
        page = get_store().expression_values_for_matrix(
            id,
            feature_id_list=feature_csv,
            biosample_id_list=biosample_csv,
            biosample_filters=bio_filt,
            feature_filters=feature_filt,
            expression_value_filters=expr_filt,
            min_value=min_value,
            max_value=max_value,
            sort=expression_value_sort_value(params.get("sort")),
            order=axis_order_value(params.get("order")),
            skip=skip_v,
            limit=page_limit,
            page_token=page_token,
        )
    except ValueError as exc:
        return error_json(400, str(exc), received=received)
    # Compatible with ExpressionValuesPage or legacy (results, total) tuple.
    if hasattr(page, "results"):
        results = page.results
        total = page.total
        next_page = getattr(page, "next_page", None)
        previous_page = getattr(page, "previous_page", None)
    else:
        results, total = page
        next_page = previous_page = None
    pagination = received.setdefault("pagination", {})
    if page_token:
        pagination["currentPage"] = page_token
    if next_page:
        pagination["nextPage"] = next_page
    if previous_page:
        pagination["previousPage"] = previous_page
    info = _expression_values_page_axes(results) if gran.value == "record" else None
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
        info=info,
    )


@router.get("/matrices/{id}/expression_values", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_expression_values(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    featureIDList: Optional[str] = Query(None),
    biosampleIDList: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
    minValue: Optional[float] = Query(None),
    maxValue: Optional[float] = Query(None),
    sort: ExpressionValueSort = Query(ExpressionValueSort.id),
    order: AxisOrder = Query(AxisOrder.asc),
    pageToken: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        entity_type="expressionValue",
    )
    params, perr = params_from_get(
        received=partial,
        featureIDList=featureIDList,
        biosampleIDList=biosampleIDList,
        minValue=minValue,
        maxValue=maxValue,
        sort=expression_value_sort_value(sort),
        order=axis_order_value(order),
    )
    if perr:
        return perr
    if params:
        partial = partial_received_for_error(
            skip=skip,
            limit=limit,
            requested_granularity=requestedGranularity,
            entity_type="expressionValue",
            extra_summary=params_summary(params) or None,
        )
    if featureIDList:
        featureIDList, ferr = parse_id_list_or_error(
            featureIDList, received=partial
        )
        if ferr:
            return ferr
        params["featureIDList"] = featureIDList
    if biosampleIDList:
        biosampleIDList, berr = parse_id_list_or_error(
            biosampleIDList, received=partial
        )
        if berr:
            return berr
        params["biosampleIDList"] = biosampleIDList
    split, sferr = resolve_expression_value_filters(
        filters_csv=filters, received=partial
    )
    if sferr:
        return sferr
    feature_filt, bio_filt, expr_filt = split
    inverted = _reject_inverted_range(params, partial)
    if inverted:
        return inverted
    params["sort"] = expression_value_sort_value(sort)
    params["order"] = axis_order_value(order)
    merged_filters = list(feature_filt or []) + list(bio_filt or []) + list(expr_filt or [])
    extra = {**params_summary(params), **(filters_summary(merged_filters) or {})}
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        extra_summary=extra or None,
        cap_limit=True,
        cap_skip=True,
        entity_type="expressionValue",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_matrix(id):
        return empty_entity_response("expressionValue", id, gran, received)
    return _expression_values_handler(
        id,
        params=params,
        feature_filt=feature_filt,
        bio_filt=bio_filt,
        expr_filt=expr_filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        page_token=_page_token_from_request(page_token=pageToken),
    )


@router.post("/matrices/{id}/expression_values", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_expression_values(
    id: str, body: ExpressionValuesRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    payload = model_to_dict(body)
    partial = partial_received_for_error(
        body=payload,
        entity_type="expressionValue",
    )
    params, perr = params_from_post(payload, received=partial)
    if perr:
        return perr
    if params:
        partial = partial_received_for_error(
            body=payload,
            entity_type="expressionValue",
            extra_summary=params_summary(params) or None,
        )
    split, sferr = resolve_expression_value_filters(body=payload, received=partial)
    if sferr:
        return sferr
    feature_filt, bio_filt, expr_filt = split
    inverted = _reject_inverted_range(params, partial)
    if inverted:
        return inverted
    params["sort"] = expression_value_sort_value(params.get("sort"))
    params["order"] = axis_order_value(params.get("order"))
    merged_filters = list(feature_filt or []) + list(bio_filt or []) + list(expr_filt or [])
    extra = {**params_summary(params), **(filters_summary(merged_filters) or {})}
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra or None,
        cap_limit=True,
        cap_skip=True,
        entity_type="expressionValue",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_matrix(id):
        return empty_entity_response("expressionValue", id, gran, received)
    return _expression_values_handler(
        id,
        params=params,
        feature_filt=feature_filt,
        bio_filt=bio_filt,
        expr_filt=expr_filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        page_token=_page_token_from_request(body=payload),
    )
