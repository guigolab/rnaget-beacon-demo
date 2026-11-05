from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Union

from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, model_validator

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
        "matrixIDList",
        "minValue",
        "maxValue",
        "order",
    }
)


class AxisOrder(str, Enum):
    """Order expression_values by cell quantification."""

    asc = "asc"
    desc = "desc"


class BeaconRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    meta: Optional[BeaconRequestMeta] = None
    query: Optional[BeaconQuery] = None

    @model_validator(mode="before")
    @classmethod
    def _reject_legacy_top_level_slice_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        legacy = ALLOWED_REQUEST_PARAMETER_KEYS & set(data.keys())
        if legacy:
            raise ValueError(
                "use query.requestParameters for "
                + ", ".join(sorted(legacy))
                + "; top-level fields are not accepted"
            )
        return data


class MatrixAxisRequestBody(BeaconRequestBody):
    """POST body for nested matrix features / biosamples listings.

    Under ``query.requestParameters``: features accept ``featureIDList`` only;
    biosamples accept ``biosampleIDList`` only.
    """

    pass


class ExpressionValuesRequestBody(BeaconRequestBody):
    """POST body for matrix expression_values.

    Slice params under ``query.requestParameters``:
    featureIDList, biosampleIDList, minValue, maxValue, order (by value).
    Top-level sibling fields and ``sort`` are not accepted.
    """

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
    *,
    received: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[str], Optional[JSONResponse]]:
    try:
        return validate_id_list_csv(value), None
    except ValueError as exc:
        return None, error_json(400, str(exc), received=received)


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


def _validate_pagination_bounds(
    skip: int, limit: int, *, cap_limit: bool, cap_skip: bool
) -> None:
    if skip < 0 or (cap_skip and skip > MAX_SKIP):
        raise PaginationLimitError(
            f"skip must be between 0 and {MAX_SKIP}, got {skip}"
        )
    if limit < 0:
        raise PaginationLimitError("limit must be at least 0")
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
        if key in ("featureIDList", "biosampleIDList", "matrixIDList"):
            try:
                out[key] = validate_id_list_csv(coerce_id_list_csv(val))
            except ValueError as exc:
                return None, str(exc)
        elif key in ("minValue", "maxValue"):
            try:
                out[key] = float(val)
            except (TypeError, ValueError):
                return None, f"requestParameters.{key} must be a number"
        elif key == "order":
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
        "matrixIDList": "matrixIDList",
        "minValue": "minValue",
        "maxValue": "maxValue",
        "order": "order",
    }
    for qkey, pkey in mapping.items():
        if kwargs.get(qkey) is not None:
            out[pkey] = kwargs[qkey]
    return out


def reject_legacy_top_level_body(
    body_dict: Dict[str, Any],
    *,
    received: Optional[Dict[str, Any]] = None,
) -> Optional[JSONResponse]:
    legacy = ALLOWED_REQUEST_PARAMETER_KEYS & set(body_dict.keys())
    if legacy:
        return error_json(
            400,
            "use query.requestParameters for "
            + ", ".join(sorted(legacy))
            + "; top-level fields are not accepted",
            received=received,
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
    cap_skip: bool = False,
    entity_type: Optional[str] = None,
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
    _validate_pagination_bounds(
        int(skip_v or 0), int(limit_v), cap_limit=cap_limit, cap_skip=cap_skip
    )
    skip_v = max(0, int(skip_v))
    if cap_skip:
        skip_v = min(skip_v, MAX_SKIP)
    # Beacon limit 0 means "as many as the server allows".
    if int(limit_v) == 0:
        limit_v = MAX_PAGE_LIMIT
    elif cap_limit:
        limit_v = max(1, min(int(limit_v), MAX_PAGE_LIMIT))
    else:
        limit_v = max(1, int(limit_v))
    gran = granularity_from_request(requested_granularity, body_dict)
    query = body_dict.get("query") or {}
    include_rs = query.get("includeResultsetResponses") if isinstance(query, dict) else None
    if include_rs:
        extra_summary = dict(extra_summary or {})
        extra_summary["includeResultsetResponses"] = include_rs
    received = build_received_summary(
        skip=skip_v,
        limit=limit_v,
        granularity=gran,
        entity_type=entity_type,
        extra=extra_summary,
    )
    return skip_v, limit_v, gran, received


def partial_received_for_error(
    *,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    requested_granularity: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    entity_type: Optional[str] = None,
    extra_summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body_dict = body or {}
    skip_v, limit_v = pagination_from_query(skip, limit, body_dict)
    try:
        gran = granularity_from_request(requested_granularity, body_dict)
    except InvalidGranularity:
        gran = Granularity.record
    return build_received_summary(
        skip=int(skip_v or 0),
        limit=int(limit_v),
        granularity=gran,
        entity_type=entity_type,
        extra=extra_summary,
    )


def resolve_or_error(
    *,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    requested_granularity: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    extra_summary: Optional[Dict[str, Any]] = None,
    cap_limit: bool = False,
    cap_skip: bool = False,
    entity_type: Optional[str] = None,
):
    partial = partial_received_for_error(
        skip=skip,
        limit=limit,
        requested_granularity=requested_granularity,
        body=body,
        entity_type=entity_type,
        extra_summary=extra_summary,
    )
    try:
        return (
            resolve_list_args(
                skip=skip,
                limit=limit,
                requested_granularity=requested_granularity,
                body=body,
                extra_summary=extra_summary,
                cap_limit=cap_limit,
                cap_skip=cap_skip,
                entity_type=entity_type,
            ),
            None,
        )
    except InvalidGranularity as exc:
        return None, error_json(400, str(exc), received=partial)
    except PaginationLimitError as exc:
        return None, error_json(400, str(exc), received=partial)
