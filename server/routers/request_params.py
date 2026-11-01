"""Parse query.requestParameters (POST) and GET query aliases."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from fastapi.responses import JSONResponse

from beacon.responses import error_json
from routers.deps import (
    reject_legacy_top_level_body,
    request_parameters_from_get,
    validate_request_parameters,
)


def params_from_post(
    body_dict: Dict[str, Any],
    *,
    received: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], Optional[JSONResponse]]:
    legacy = reject_legacy_top_level_body(body_dict, received=received)
    if legacy:
        return {}, legacy
    query = body_dict.get("query") or {}
    raw = query.get("requestParameters")
    params, err = validate_request_parameters(raw)
    if err:
        return {}, error_json(400, err, received=received)
    return params or {}, None


def params_from_get(
    *,
    received: Optional[Dict[str, Any]] = None,
    **query_values: Any,
) -> Tuple[Dict[str, Any], Optional[JSONResponse]]:
    raw = request_parameters_from_get(**query_values)
    params, err = validate_request_parameters(raw)
    if err:
        return {}, error_json(400, err, received=received)
    return params or {}, None


def params_summary(params: Dict[str, Any]) -> Dict[str, Any]:
    if not params:
        return {}
    return {"requestParameters": {k: v for k, v in params.items() if v is not None}}
