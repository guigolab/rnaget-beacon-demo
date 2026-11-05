from typing import Any, Dict, List, Optional, Union

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
from routers.common import (
    FILTERS_CSV_QUERY_DESCRIPTION,
    empty_entity_response,
    list_response,
    page_filtering_terms,
)
from routers.deps import (
    AxisOrder,
    BeaconRequestBody,
    ExpressionValuesRequestBody,
    MatrixAxisRequestBody,
    axis_order_value,
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


@router.get("/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getMatrices")
def get_matrices(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None, description=FILTERS_CSV_QUERY_DESCRIPTION),
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


@router.post("/matrices", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postMatricesRequest")
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


@router.get("/matrices/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getOneMatrix")
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


@router.post("/matrices/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postOneMatrix")
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


def _reject_disallowed_request_parameters(
    params: Dict[str, Any],
    allowed: frozenset,
    received,
) -> Optional[JSONResponse]:
    bad = set(params) - allowed
    if bad:
        return error_json(
            400,
            "unsupported requestParameters for this path: "
            + ", ".join(sorted(bad)),
            received=received,
        )
    return None


def _listing_extra(
    params: Dict[str, Any],
    *filter_groups,
) -> Dict[str, Any]:
    extra: Dict[str, Any] = {}
    merged: List[Any] = []
    for group in filter_groups:
        if group:
            merged.extend(group)
    if merged:
        extra.update(filters_summary(merged) or {})
    rp = params_summary(params)
    if rp:
        extra.update(rp)
    return extra


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


def _matrix_nested_list(
    id: str,
    *,
    kind: str,
    entity_type: str,
    filt,
    skip_v: int,
    limit_v: int,
    gran,
    received,
    biosample_filters=None,
    feature_filters=None,
    feature_id_list: Optional[str] = None,
    biosample_id_list: Optional[str] = None,
):
    """Nested features/biosamples listing (id order; matching ID-list filter only)."""
    store = get_store()
    page_limit = limit_v if gran.value == "record" else 0
    # Store APIs still accept sort/order; use stable id/asc defaults.
    if kind == "features":
        results, total = store.features_for_matrix_page(
            id,
            skip=skip_v,
            limit=page_limit,
            sort="id",
            order="asc",
            biosample_filters=biosample_filters if biosample_filters is not None else filt,
            feature_filters=feature_filters,
            feature_id_list=feature_id_list,
            biosample_id_list=None,
            min_value=None,
            max_value=None,
        )
    else:
        results, total = store.biosamples_for_matrix_page(
            id,
            skip=skip_v,
            limit=page_limit,
            sort="id",
            order="asc",
            filters=filt,
            feature_id_list=None,
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


_FEATURES_RP = frozenset({"featureIDList"})
_BIOSAMPLES_RP = frozenset({"biosampleIDList"})


@router.get("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getOneMatrixFeatures")
def get_matrix_features(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None, description=FILTERS_CSV_QUERY_DESCRIPTION),
    featureIDList: Optional[str] = Query(None, description="Comma-separated feature IDs."),
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
    )
    if perr:
        return perr
    bad = _reject_disallowed_request_parameters(params, _FEATURES_RP, partial)
    if bad:
        return bad
    extra = _listing_extra(params, feature_filters, biosample_filters)
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
    if not store.get_matrix(id):
        return empty_entity_response("feature", id, gran, received)
    return _matrix_nested_list(
        id,
        kind="features",
        entity_type="feature",
        filt=biosample_filters,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        biosample_filters=biosample_filters,
        feature_filters=feature_filters,
        feature_id_list=params.get("featureIDList"),
    )


@router.post("/matrices/{id}/features", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postOneMatrixFeatures")
def post_matrix_features(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    payload = model_to_dict(body)
    partial = partial_received_for_error(body=payload, entity_type="feature")
    params, perr = params_from_post(payload, received=partial)
    if perr:
        return perr
    bad = _reject_disallowed_request_parameters(params, _FEATURES_RP, partial)
    if bad:
        return bad
    split, ferr = resolve_matrix_feature_axis_filters(
        body=payload, received=partial
    )
    if ferr:
        return ferr
    feature_filters, biosample_filters = split
    extra = _listing_extra(params, feature_filters, biosample_filters)
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra or None,
        cap_limit=True,
        entity_type="feature",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not store.get_matrix(id):
        return empty_entity_response("feature", id, gran, received)
    return _matrix_nested_list(
        id,
        kind="features",
        entity_type="feature",
        filt=biosample_filters,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        biosample_filters=biosample_filters,
        feature_filters=feature_filters,
        feature_id_list=params.get("featureIDList"),
    )


@router.get(
    "/matrices/{id}/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
    operation_id="getOneMatrixFilteringTerms",
)
@router.post(
    "/matrices/{id}/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
    operation_id="postOneMatrixFilteringTerms",
)
def matrix_scoped_filtering_terms(
    id: str,
    skip: int = Query(0, ge=0, description="Number of terms to skip."),
    limit: int = Query(
        0,
        ge=0,
        description="Max terms to return; 0 means the server maximum (1000).",
    ),
):
    from beacon.http_cache import json_with_headers, package_etag

    store = get_store()
    if not store.get_matrix(id):
        return build_filtering_terms_response([])
    getter = getattr(store, "matrix_scoped_filtering_terms", None)
    if callable(getter):
        terms, resources = getter(id)
        body = build_filtering_terms_response(
            page_filtering_terms(terms, skip=skip, limit=limit),
            resources,
        )
        return json_with_headers(
            body,
            etag=package_etag(f"{store.package_fingerprint()}:{id}"),
            cache_control="public, max-age=300",
        )
    return build_filtering_terms_response([])


@router.get("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getOneMatrixBiosamples")
def get_matrix_biosamples(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None, description=FILTERS_CSV_QUERY_DESCRIPTION),
    biosampleIDList: Optional[str] = Query(None, description="Comma-separated biosample IDs."),
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
        biosampleIDList=biosampleIDList,
    )
    if perr:
        return perr
    bad = _reject_disallowed_request_parameters(params, _BIOSAMPLES_RP, partial)
    if bad:
        return bad
    extra = _listing_extra(params, filt)
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary=extra or None,
        entity_type="biosample",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not store.get_matrix(id):
        return empty_entity_response("biosample", id, gran, received)
    return _matrix_nested_list(
        id,
        kind="biosamples",
        entity_type="biosample",
        filt=filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        biosample_id_list=params.get("biosampleIDList"),
    )


@router.post("/matrices/{id}/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postOneMatrixBiosamples")
def post_matrix_biosamples(
    id: str, body: MatrixAxisRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    store = get_store()
    payload = model_to_dict(body)
    partial = partial_received_for_error(body=payload, entity_type="biosample")
    params, perr = params_from_post(payload, received=partial)
    if perr:
        return perr
    bad = _reject_disallowed_request_parameters(params, _BIOSAMPLES_RP, partial)
    if bad:
        return bad
    filt, ferr = resolve_entity_filters(
        entity="biosample", body=payload, received=partial
    )
    if ferr:
        return ferr
    extra = _listing_extra(params, filt)
    resolved, err = resolve_or_error(
        body=payload,
        extra_summary=extra or None,
        cap_limit=True,
        entity_type="biosample",
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not store.get_matrix(id):
        return empty_entity_response("biosample", id, gran, received)
    return _matrix_nested_list(
        id,
        kind="biosamples",
        entity_type="biosample",
        filt=filt,
        skip_v=skip_v,
        limit_v=limit_v,
        gran=gran,
        received=received,
        biosample_id_list=params.get("biosampleIDList"),
    )


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
            order=axis_order_value(params.get("order")),
            skip=skip_v,
            limit=page_limit,
            page_token=page_token,
        )
    except ValueError as exc:
        return error_json(400, str(exc), received=received)
    results = page.results
    total = page.total
    next_page = getattr(page, "next_page", None)
    previous_page = getattr(page, "previous_page", None)
    pagination = received.setdefault("pagination", {})
    if page_token:
        pagination["currentPage"] = page_token
    if next_page:
        pagination["nextPage"] = next_page
    if previous_page:
        pagination["previousPage"] = previous_page
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


@router.get("/matrices/{id}/expression_values", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="getOneMatrixExpressionValues")
def get_expression_values(
    id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
    requestedGranularity: Optional[str] = Query(None),
    featureIDList: Optional[str] = Query(None, description="Comma-separated feature IDs."),
    biosampleIDList: Optional[str] = Query(None, description="Comma-separated biosample IDs."),
    filters: Optional[str] = Query(None, description=FILTERS_CSV_QUERY_DESCRIPTION),
    minValue: Optional[float] = Query(None, description="Minimum expression value."),
    maxValue: Optional[float] = Query(None, description="Maximum expression value."),
    order: AxisOrder = Query(AxisOrder.asc, description="Order by value: asc | desc."),
    pageToken: Optional[str] = Query(
        None,
        description="RNAget extension: opaque keyset page token (prefer over deep skip).",
    ),
    # Reject legacy ``sort`` query (removed; ordering is always by value).
    sort: Optional[str] = Query(None, include_in_schema=False),
) -> Union[Dict[str, Any], JSONResponse]:
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        entity_type="expressionValue",
    )
    if sort is not None:
        return error_json(
            400,
            "sort is not supported for expression_values; "
            "results are ordered by value (use order)",
            received=partial,
        )
    params, perr = params_from_get(
        received=partial,
        featureIDList=featureIDList,
        biosampleIDList=biosampleIDList,
        minValue=minValue,
        maxValue=maxValue,
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


@router.post("/matrices/{id}/expression_values", response_model=None, responses=OPENAPI_BEACON_RESPONSES, operation_id="postOneMatrixExpressionValues")
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
    if "sort" in params:
        return error_json(
            400,
            "requestParameters.sort is not supported for expression_values; "
            "results are ordered by value (use order)",
            received=partial,
        )
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
