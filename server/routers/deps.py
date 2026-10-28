from typing import Any, Dict, Optional, Tuple

from pydantic import BaseModel

from beacon.responses import (
    InvalidGranularity,
    build_received_summary,
    error_json,
    granularity_from_request,
    pagination_from_query,
)
from beacon.schemas.envelopes import Granularity


class BeaconRequestBody(BaseModel):
    meta: Optional[Dict[str, Any]] = None
    query: Optional[Dict[str, Any]] = None


class ExpressionValuesRequestBody(BeaconRequestBody):
    featureIDList: Optional[str] = None
    biosampleIDList: Optional[str] = None
    minValue: Optional[float] = None
    maxValue: Optional[float] = None
    skip: Optional[int] = None
    limit: Optional[int] = None


def model_to_dict(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=True)
    return model.dict(exclude_none=True)


def resolve_list_args(
    *,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    requested_granularity: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    extra_summary: Optional[Dict[str, Any]] = None,
) -> Tuple[int, int, Granularity, Dict[str, Any]]:
    """Return skip, limit, granularity, receivedRequestSummary.

    Raises InvalidGranularity on bad granularity values.
    """
    body_dict = body or {}
    skip_v, limit_v = pagination_from_query(skip, limit, body_dict)
    if body is not None:
        if body.get("skip") is not None and skip is None:
            skip_v = int(body["skip"])
        if body.get("limit") is not None and limit is None:
            limit_v = int(body["limit"])
    gran = granularity_from_request(requested_granularity, body_dict)
    received = build_received_summary(
        skip=skip_v, limit=limit_v, granularity=gran, extra=extra_summary
    )
    return skip_v, limit_v, gran, received


def resolve_or_error(
    *,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    requested_granularity: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    extra_summary: Optional[Dict[str, Any]] = None,
):
    """Like resolve_list_args but returns (None, error_json) on bad granularity."""
    try:
        return (
            resolve_list_args(
                skip=skip,
                limit=limit,
                requested_granularity=requested_granularity,
                body=body,
                extra_summary=extra_summary,
            ),
            None,
        )
    except InvalidGranularity as exc:
        return None, error_json(400, str(exc))
