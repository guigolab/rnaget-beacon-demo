from typing import Any, Dict, List, Optional

from fastapi.responses import JSONResponse

from beacon import config
from beacon.schemas.envelopes import Granularity


class InvalidGranularity(ValueError):
    """Raised when requestedGranularity is not boolean|count|record."""


def requested_schemas_for_entity(entity_type: Optional[str]) -> List[Dict[str, str]]:
    if not entity_type:
        return []
    schema_id = config.SCHEMA_IDS.get(entity_type)
    if not schema_id:
        return []
    return [{"entityType": entity_type, "schema": schema_id}]


def build_received_summary(
    *,
    skip: int = 0,
    limit: int = 10,
    granularity: Granularity = Granularity.record,
    entity_type: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "apiVersion": config.API_VERSION,
        "requestedSchemas": requested_schemas_for_entity(entity_type),
        "requestedGranularity": granularity.value,
        "pagination": {"skip": skip, "limit": limit},
    }
    if extra:
        summary.update({k: v for k, v in extra.items() if v is not None})
    return summary


def default_error_received(
    *,
    granularity: Granularity = Granularity.record,
    skip: int = 0,
    limit: int = 10,
    entity_type: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return build_received_summary(
        skip=skip,
        limit=limit,
        granularity=granularity,
        entity_type=entity_type,
        extra=extra,
    )


def _meta(
    entity_type: str,
    schema_id: str,
    granularity: Optional[Granularity] = None,
    received: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "apiVersion": config.API_VERSION,
        "beaconId": config.BEACON_ID,
        "returnedSchemas": [{"entityType": entity_type, "schema": schema_id}],
    }
    if granularity is not None:
        meta["returnedGranularity"] = granularity.value
        meta["receivedRequestSummary"] = received or build_received_summary(
            granularity=granularity,
            entity_type=entity_type,
        )
    return meta


def build_resultsets_response(
    *,
    entity_type: str,
    results: List[Dict[str, Any]],
    set_id: str = "default",
    granularity: Granularity = Granularity.record,
    skip: int = 0,
    limit: int = 10,
    received: Optional[Dict[str, Any]] = None,
    total_count: Optional[int] = None,
    results_are_page: bool = False,
) -> Dict[str, Any]:
    schema_id = config.SCHEMA_IDS[entity_type]
    total = len(results) if total_count is None else int(total_count)
    exists = total > 0
    if granularity == Granularity.record:
        if results_are_page:
            page = results
        else:
            page = results[skip : skip + limit]
    else:
        page = []

    include_mode = (received or {}).get("includeResultsetResponses")
    if include_mode == "NONE" or (
        include_mode == "HIT" and not exists
    ) or (include_mode == "MISS" and exists):
        result_sets: List[Dict[str, Any]] = []
        page = []
    elif include_mode == "MISS":
        page = []
        result_sets = [
            {
                "id": set_id,
                "setType": entity_type,
                "exists": exists,
                "resultsCount": 0,
                "results": [],
            }
        ]
    else:
        result_sets = [
            {
                "id": set_id,
                "setType": entity_type,
                "exists": exists,
                "resultsCount": len(page),
                "results": page,
            }
        ]

    if received is None:
        received = build_received_summary(
            skip=skip,
            limit=limit,
            granularity=granularity,
            entity_type=entity_type,
        )
    meta = _meta(entity_type, schema_id, granularity, received)

    if granularity == Granularity.boolean:
        return {
            "meta": meta,
            "responseSummary": {"exists": exists},
        }
    if granularity == Granularity.count:
        return {
            "meta": meta,
            "responseSummary": {"exists": exists, "numTotalResults": total},
        }

    return {
        "meta": meta,
        "responseSummary": {"exists": exists, "numTotalResults": total},
        "response": {"resultSets": result_sets},
    }


def build_informational_response(
    *,
    entity_type: str,
    schema_key: str,
    response_body: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "meta": _meta(entity_type, config.SCHEMA_IDS[schema_key]),
        "response": response_body,
    }


def build_filtering_terms_response(
    terms: Optional[List[Dict[str, Any]]] = None,
    resources: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "meta": _meta("filteringTerm", config.SCHEMA_IDS["filteringTerms"]),
        "response": {
            "filteringTerms": terms or [],
            "resources": resources or [],
        },
    }


def build_error_response(
    error_code: int,
    error_message: str,
    *,
    received: Optional[Dict[str, Any]] = None,
    returned_granularity: Optional[Granularity] = None,
) -> Dict[str, Any]:
    summary = received or default_error_received()
    gran_value = (
        returned_granularity.value
        if returned_granularity is not None
        else summary.get("requestedGranularity", Granularity.record.value)
    )
    meta: Dict[str, Any] = {
        "apiVersion": config.API_VERSION,
        "beaconId": config.BEACON_ID,
        "returnedSchemas": [],
        "returnedGranularity": gran_value,
        "receivedRequestSummary": summary,
    }
    return {
        "meta": meta,
        "error": {
            "errorCode": error_code,
            "errorMessage": error_message,
        },
    }


def error_json(
    error_code: int,
    error_message: str,
    *,
    received: Optional[Dict[str, Any]] = None,
    returned_granularity: Optional[Granularity] = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=error_code,
        content=build_error_response(
            error_code,
            error_message,
            received=received,
            returned_granularity=returned_granularity,
        ),
    )


def parse_granularity(value: Optional[str]) -> Granularity:
    if not value:
        return Granularity.record
    try:
        return Granularity(value)
    except ValueError as exc:
        raise InvalidGranularity(
            f"Invalid requestedGranularity '{value}'; "
            "expected one of: boolean, count, record"
        ) from exc


def pagination_from_query(
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    body: Optional[Dict[str, Any]] = None,
) -> tuple:
    body = body or {}
    query = body.get("query") or {}
    pagination = query.get("pagination") or {}
    skip_v = skip if skip is not None else pagination.get("skip", 0)
    if limit is not None:
        limit_v = limit
    elif isinstance(pagination, dict) and "limit" in pagination:
        limit_v = pagination.get("limit")
    else:
        limit_v = 10
    return int(skip_v or 0), int(limit_v)


def granularity_from_request(
    requested: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Granularity:
    body = body or {}
    query = body.get("query") or {}
    value = requested or query.get("requestedGranularity")
    return parse_granularity(value)
