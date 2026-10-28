from typing import Any, Dict, List, Optional

from fastapi.responses import JSONResponse

from beacon import config
from beacon.schemas.envelopes import Granularity


class InvalidGranularity(ValueError):
    """Raised when requestedGranularity is not boolean|count|record."""


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
        "receivedRequestSummary": received
        or {"apiVersion": config.API_VERSION.lstrip("v")},
    }
    if granularity is not None:
        meta["returnedGranularity"] = granularity.value
    return meta


def build_received_summary(
    *,
    skip: int = 0,
    limit: int = 10,
    granularity: Granularity = Granularity.record,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "apiVersion": config.API_VERSION.lstrip("v"),
        "requestedGranularity": granularity.value,
        "pagination": {"skip": skip, "limit": limit},
    }
    if extra:
        summary.update({k: v for k, v in extra.items() if v is not None})
    return summary


def build_resultsets_response(
    *,
    entity_type: str,
    results: List[Dict[str, Any]],
    set_id: str = "default",
    granularity: Granularity = Granularity.record,
    skip: int = 0,
    limit: int = 10,
    received: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    schema_id = config.SCHEMA_IDS[entity_type]
    total = len(results)
    exists = total > 0
    page = results[skip : skip + limit] if granularity == Granularity.record else []

    if received is None:
        received = build_received_summary(
            skip=skip, limit=limit, granularity=granularity
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
        "response": {
            "resultSets": [
                {
                    "id": set_id,
                    "setType": entity_type,
                    "exists": exists,
                    "resultsCount": len(page),
                    "results": page,
                }
            ]
        },
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
) -> Dict[str, Any]:
    return {
        "meta": _meta("filteringTerm", config.SCHEMA_IDS["filteringTerms"]),
        "response": {
            "filteringTerms": terms or [],
            "resources": [],
        },
    }


def build_error_response(
    error_code: int,
    error_message: str,
) -> Dict[str, Any]:
    return {
        "meta": {
            "apiVersion": config.API_VERSION,
            "beaconId": config.BEACON_ID,
            "returnedSchemas": [],
        },
        "error": {
            "errorCode": error_code,
            "errorMessage": error_message,
        },
    }


def error_json(error_code: int, error_message: str) -> JSONResponse:
    return JSONResponse(
        status_code=error_code,
        content=build_error_response(error_code, error_message),
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
    limit_v = limit if limit is not None else pagination.get("limit", 10)
    return int(skip_v or 0), int(limit_v or 10)


def granularity_from_request(
    requested: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Granularity:
    body = body or {}
    query = body.get("query") or {}
    value = requested or query.get("requestedGranularity")
    return parse_granularity(value)
