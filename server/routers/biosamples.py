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
from routers.deps import BeaconRequestBody, model_to_dict, resolve_or_error
from routers.filter_helpers import filters_summary, resolve_entity_filters
from routers.request_params import params_from_post

router = APIRouter(tags=["Biosamples"])


@router.get("/biosamples", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def get_biosamples(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1),
    requestedGranularity: Optional[str] = Query(None),
    filters: Optional[str] = Query(None),
) -> Union[Dict[str, Any], JSONResponse]:
    filt, ferr = resolve_entity_filters(entity="biosample", filters_csv=filters)
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
        extra_summary={"filters": filters_summary(filt)} if filt else None,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().list_biosamples_page(
        skip=skip_v, limit=page_limit, filters=filt or None
    )
    return list_response(
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
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
    filt, ferr = resolve_entity_filters(entity="biosample", body=body_dict)
    if ferr:
        return ferr
    resolved, err = resolve_or_error(
        body=body_dict,
        cap_limit=True,
        extra_summary={"filters": filters_summary(filt)} if filt else None,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    page_limit = limit_v if gran.value == "record" else 0
    results, total = get_store().list_biosamples_page(
        skip=skip_v, limit=page_limit, filters=filt or None
    )
    return list_response(
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
    resolved, err = resolve_or_error(requested_granularity=requestedGranularity)
    if err:
        return err
    _, _, gran, received = resolved
    if not item:
        return empty_entity_response("biosample", id, gran, received)
    return list_response([item], "biosample", id, 0, 1, gran, received)


@router.post("/biosamples/{id}", response_model=None, responses=OPENAPI_BEACON_RESPONSES)
def post_biosample(
    id: str, body: BeaconRequestBody = Body(...)
) -> Union[Dict[str, Any], JSONResponse]:
    item = get_store().get_biosample(id)
    body_dict = model_to_dict(body)
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
    resolved, err = resolve_or_error(body=body_dict)
    if err:
        return err
    _, _, gran, received = resolved
    if not item:
        return empty_entity_response("biosample", id, gran, received)
    return list_response([item], "biosample", id, 0, 1, gran, received)


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
    resolved, err = resolve_or_error(
        skip=skip,
        limit=limit,
        requested_granularity=requestedGranularity,
        cap_limit=True,
    )
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_biosample(id):
        return empty_entity_response("matrix", id, gran, received)
    results = get_store().matrices_for_biosample(id)
    return list_response(
        results,
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
    body_dict = model_to_dict(body)
    _, perr = params_from_post(body_dict)
    if perr:
        return perr
    resolved, err = resolve_or_error(body=body_dict, cap_limit=True)
    if err:
        return err
    skip_v, limit_v, gran, received = resolved
    if not get_store().get_biosample(id):
        return empty_entity_response("matrix", id, gran, received)
    results = get_store().matrices_for_biosample(id)
    return list_response(
        results,
        "matrix",
        id,
        skip_v,
        limit_v,
        gran,
        received,
    )
