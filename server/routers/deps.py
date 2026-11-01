from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Union

from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from beacon.responses import (
    InvalidGranularity,
    build_received_summary,
    error_json,
    granularity_from_request,
    pagination_from_query,
)
from beacon.schemas.envelopes import (
    BeaconQuery,
    BeaconRequestMeta,
    Granularity,
)

# Hard cap for expression / feature list pages (keeps RAM bounded).
MAX_PAGE_LIMIT = 1000
MAX_SKIP = 100_000
MAX_ID_LIST_TOKENS = 200
MAX_ID_LIST_CHARS = 8_000


class AxisSort(str, Enum):
    id = "id"
    expression_min = "expression.min"
    expression_max = "expression.max"


class AxisOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class BeaconRequestBody(BaseModel):
    meta: Optional[BeaconRequestMeta] = None
    query: Optional[BeaconQuery] = None


def validate_id_list_csv(value: Optional[str]) -> Optional[str]:
    """Reject oversized CSV id lists (DoS / giant IN clauses)."""
    if value is None:
        return None
    text = str(value)
    if len(text) > MAX_ID_LIST_CHARS:
        raise ValueError(f"id list exceeds {MAX_ID_LIST_CHARS} characters")
    tokens = [p.strip() for p in text.split(",") if p.strip()]
    if len(tokens) > MAX_ID_LIST_TOKENS:
        raise ValueError(f"id list exceeds {MAX_ID_LIST_TOKENS} entries")
    return text


def coerce_id_list_csv(value: Any) -> Optional[str]:
    """Accept CSV string or JSON array of ids for POST bodies."""
    if value is None:
        return None
    if isinstance(value, list):
        tokens = [str(v).strip() for v in value if str(v).strip()]
        return ",".join(tokens) if tokens else None
    text = str(value).strip()
    return text or None


def parse_id_list_or_error(
    value: Optional[str],
) -> Tuple[Optional[str], Optional[JSONResponse]]:
    """Validate a query-string CSV id list; return (value, error_response)."""
    try:
        return validate_id_list_csv(value), None
    except ValueError as exc:
        return None, error_json(400, str(exc))


class ExpressionValuesRequestBody(BeaconRequestBody):
    featureIDList: Optional[Union[str, List[str]]] = None
    biosampleIDList: Optional[Union[str, List[str]]] = None
    minValue: Optional[float] = None
    maxValue: Optional[float] = None
    groupBy: Optional[str] = None
    threshold: Optional[float] = None
    skip: Optional[int] = None
    limit: Optional[int] = None

    @field_validator("featureIDList", "biosampleIDList")
    @classmethod
    def _validate_id_list(cls, value: Any) -> Optional[str]:
        return validate_id_list_csv(coerce_id_list_csv(value))


class MatrixAxisRequestBody(BeaconRequestBody):
    """POST body for nested matrix features / biosamples listings."""

    sort: Optional[AxisSort] = None
    order: Optional[AxisOrder] = None
    skip: Optional[int] = None
    limit: Optional[int] = None


def axis_sort_value(sort: Union[AxisSort, str, None]) -> str:
    if sort is None:
        return AxisSort.id.value
    if isinstance(sort, AxisSort):
        return sort.value
    return str(sort)


def axis_order_value(order: Union[AxisOrder, str, None]) -> str:
    if order is None:
        return AxisOrder.asc.value
    if isinstance(order, AxisOrder):
        return order.value
    return str(order)


def model_to_dict(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json", exclude_none=True)
    return model.dict(exclude_none=True)


def clamp_page_limit(limit: int) -> int:
    return max(1, min(int(limit), MAX_PAGE_LIMIT))


def clamp_skip(skip: int) -> int:
    return max(0, min(int(skip), MAX_SKIP))


def resolve_list_args(
    *,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    requested_granularity: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    extra_summary: Optional[Dict[str, Any]] = None,
    cap_limit: bool = False,
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
    skip_v = clamp_skip(skip_v)
    if cap_limit:
        limit_v = clamp_page_limit(limit_v)
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
    cap_limit: bool = False,
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
                cap_limit=cap_limit,
            ),
            None,
        )
    except InvalidGranularity as exc:
        return None, error_json(400, str(exc))
