"""Shared Beacon filter resolution for routers."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from fastapi.responses import JSONResponse

from beacon.filters import (
    filters_to_summary,
    normalize_filters,
    parse_get_filters_csv,
    validate_filters_for_entity,
)
from beacon.responses import error_json


def resolve_entity_filters(
    *,
    entity: str,
    filters_csv: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    received: Optional[Dict[str, Any]] = None,
):
    try:
        if body is not None:
            query = body.get("query") or {}
            raw = query.get("filters") if isinstance(query, dict) else None
            filters = normalize_filters(raw)
        else:
            filters = parse_get_filters_csv(filters_csv)
        err = validate_filters_for_entity(filters, entity=entity)
        if err:
            return None, error_json(400, err, received=received)
        return filters, None
    except ValueError as exc:
        return None, error_json(400, str(exc), received=received)


def filters_summary(filters) -> Optional[Dict[str, Any]]:
    if not filters:
        return None
    return {"filters": filters_to_summary(filters)}
