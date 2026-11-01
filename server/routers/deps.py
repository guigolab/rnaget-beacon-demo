from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Union

from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, field_validator

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

MAX_PAGE_LIMIT = 1000
MAX_SKIP = 100_000
MAX_ID_LIST_TOKENS = 200
MAX_ID_LIST_CHARS = 8_000

ALLOWED_REQUEST_PARAMETER_KEYS = frozenset(
    {
        "featureIDList",
        "biosampleIDList",
        "minValue",
        "maxValue",
        "groupBy",
        "threshold",
        "sort",
        "order",
    }
)


class AxisSort(str, Enum):
    id = "id"
    expression_min = "expression.min"
    expression_max = "expression.max"


class AxisOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class BeaconRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    meta: Optional[BeaconRequestMeta] = None
    query: Optional[BeaconQuery] = None


class MatrixAxisRequestBody(BeaconRequestBody):
    """POST body for nested matrix features / biosamples listings."""

    pass


class ExpressionValuesRequestBody(BeaconRequestBody):
    """POST body for matrix expression_values / expression_summary."""

    pass


def validate_id_list_csv(value: Optional[str]) -> Optional[str]:
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
    try:
        return validate_id_list_csv(value), None
    except ValueError as exc:
        return None, error_json(400, str(exc))


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


class PaginationLimitError(ValueError):
    pass


def _validate_pagination_bounds(skip: int, limit: int, *, cap_limit: bool) -> None:
    if skip < 0 or skip > MAX_SKIP:
        raise PaginationLimitError(
            f"skip must be between 0 and {MAX_SKIP}, got {skip}"
        )
    if limit < 1:
        raise PaginationLimitError("limit must be at least 1")
    if cap_limit and limit > MAX_PAGE_LIMIT:
        raise PaginationLimitError(
            f"limit must not exceed {MAX_PAGE_LIMIT}, got {limit}"
        )


def validate_request_parameters(raw: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Return (params dict, error message)."""
    if raw is None:
        return {}, None
    if not isinstance(raw, dict):
        return None, "query.requestParameters must be an object"
    unknown = set(raw.keys()) - ALLOWED_REQUEST_PARAMETER_KEYS
    if unknown:
        return None, f"unknown requestParameters keys: {sorted(unknown)}"
    out: Dict[str, Any] = {}
    for key in ALLOWED_REQUEST_PARAMETER_KEYS:
        if key not in raw or raw[key] is None:
            continue
        val = raw[key]
        if key in ("featureIDList", "biosampleIDList"):
            try:
                out[key] = validate_id_list_csv(coerce_id_list_csv(val))
            except ValueError as exc:
                return None, str(exc)
        elif key in ("minValue", "maxValue", "threshold"):
            try:
                out[key] = float(val)
            except (TypeError, ValueError):
                return None, f"requestParameters.{key} must be a number"
        elif key in ("sort", "order", "groupBy"):
            out[key] = str(val)
        else:
            out[key] = val
    return out, None


def request_parameters_from_get(**kwargs: Any) -> Dict[str, Any]:
    """Build internal requestParameters from GET query aliases."""
    out: Dict[str, Any] = {}
    mapping = {
        "featureIDList": "featureIDList",
        "biosampleIDList": "biosampleIDList",
        "minValue": "minValue",
        "maxValue": "maxValue",
        "groupBy": "groupBy",
        "threshold": "threshold",
        "sort": "sort",
        "order": "order",
    }
    for qkey, pkey in mapping.items():
        if kwargs.get(qkey) is not None:
            out[pkey] = kwargs[qkey]
    return out


def reject_legacy_top_level_body(body_dict: Dict[str, Any]) -> Optional[JSONResponse]:
    legacy = ALLOWED_REQUEST_PARAMETER_KEYS & set(body_dict.keys())
    if legacy:
        return error_json(
            400,
            "use query.requestParameters for "
            + ", ".join(sorted(legacy))
            + "; top-level fields are not accepted",
        )
    return None


def resolve_list_args(
    *,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    requested_granularity: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    extra_summary: Optional[Dict[str, Any]] = None,
    cap_limit: bool = False,
) -> Tuple[int, int, Granularity, Dict[str, Any]]:
    body_dict = body or {}
    skip_v, limit_v = pagination_from_query(skip, limit, body_dict)
    if body is not None:
        if body.get("skip") is not None and skip is None:
            skip_v = int(body["skip"])
        if body.get("limit") is not None and limit is not None:
            pass
        if body.get("limit") is not None and limit is None:
            limit_v = int(body["limit"])
    _validate_pagination_bounds(int(skip_v or 0), int(limit_v or 10), cap_limit=cap_limit)
    skip_v = max(0, min(int(skip_v), MAX_SKIP))
    if cap_limit:
        limit_v = max(1, min(int(limit_v), MAX_PAGE_LIMIT))
    else:
        limit_v = max(1, int(limit_v))
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
    except PaginationLimitError as exc:
        return None, error_json(400, str(exc))
