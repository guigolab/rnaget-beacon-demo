from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from beacon.filters import (
    filters_to_summary,
    normalize_filters,
    parse_get_filters_csv,
    validate_filters_for_entity,
)
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


def _resolve_biosample_filters(
    *,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
):
    try:
        if body is not None:
            query = body.get("query") or {}
            raw = query.get("filters") if isinstance(query, dict) else None
            filters = normalize_filters(raw)
        else:
            filters = parse_get_filters_csv(filters_csv)
        err = validate_filters_for_entity(filters, entity="biosample")
        if err:
            return None, error_json(400, err)
        return filters, None
    except ValueError as exc:
        return None, error_json(400, str(exc))


@router.get("/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_biosamples(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    filt, ferr = _resolve_biosample_filters(filters_csv=filters)
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary={"filters": filters_to_summary(filt)} if filt else None,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().list_biosamples_page(
        skip=skip_v, limit=page_limit, filters=filt or None
    )
    return _list_response(
        results,
        "biosample",
        "biosamples",
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


@router.post("/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_biosamples(
    body: BeaconRequestBody = Body(...),
) -> Union[Dict[str, Any], JSONResponse]:
    body_dict = model_to_dict(body)
    filt, ferr = _resolve_biosample_filters(body=body_dict)
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary={"filters": filters_to_summary(filt)} if filt else None,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().list_biosamples_page(
        skip=skip_v, limit=page_limit, filters=filt or None
    )
    return _list_response(
        results,
        "biosample",
        "biosamples",
        skip_v,
        limit_v,
        gran,
        received,
        total_count=total,
        results_are_page=True,
    )


@router.get(
    "/biosamples/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
@router.post(
    "/biosamples/filtering_terms",
    response_model=None,
    responses=OPENAPI_FILTERING_TERMS_RESPONSES,
)
def biosamples_filtering_terms():
    terms, resources = get_store().filtering_terms(scopes=["biosample"])
    return build_filtering_terms_response(terms, resources)


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
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
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
    resolved, err = resolve_or_error(body=model_to_dict(body), cap_limit=True)
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
