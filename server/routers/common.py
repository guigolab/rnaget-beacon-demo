"""Shared router helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi.responses import JSONResponse

from beacon.responses import build_resultsets_response, error_json
from beacon.schemas.envelopes import Granularity
from routers.deps import MAX_PAGE_LIMIT, MAX_SKIP

# OpenAPI description for GET ``filters`` (CSV; POST uses filter arrays).
FILTERS_CSV_QUERY_DESCRIPTION = (
    "Comma-separated Beacon filters (RNAget GET convention). "
    "POST uses query.filters as a JSON array. "
    "symbol: filters match aliases/symbols with exact case (Alb ≠ ALB)."
)


INCLUDE_RESULTSET_DESCRIPTION = (
    "Beacon includeResultsetResponses: ALL (default), HIT, MISS or NONE."
)
REQUESTED_SCHEMA_DESCRIPTION = (
    "Beacon requestedSchema. Only the default schema of each entry type is "
    "served; the value is accepted and otherwise ignored."
)
_INCLUDE_RESULTSET_VALUES = ("ALL", "HIT", "MISS", "NONE")


def include_resultset_summary(
    value: Optional[str],
    *,
    received: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], Optional[JSONResponse]]:
    """Validate GET ``includeResultsetResponses`` and return its summary entry."""
    if value is None or value == "":
        return {}, None
    upper = str(value).upper()
    if upper not in _INCLUDE_RESULTSET_VALUES:
        return {}, error_json(
            400,
            "includeResultsetResponses must be one of: "
            + ", ".join(_INCLUDE_RESULTSET_VALUES),
            received=received,
        )
    return {"includeResultsetResponses": upper}, None


def page_filtering_terms(
    terms: List[Dict[str, Any]],
    *,
    skip: int = 0,
    limit: int = 0,
) -> List[Dict[str, Any]]:
    """Apply skip/limit to a filtering-terms list.

    ``limit`` 0 means the server maximum (``MAX_PAGE_LIMIT``), matching collection
    routes. ``skip`` is clamped to ``MAX_SKIP``.
    """
    skip_v = max(0, min(int(skip), MAX_SKIP))
    if int(limit) <= 0:
        limit_v = MAX_PAGE_LIMIT
    else:
        limit_v = max(0, min(int(limit), MAX_PAGE_LIMIT))
    return terms[skip_v : skip_v + limit_v]


def list_response(
    results: List[Dict[str, Any]],
    entity_type: str,
    set_id: str,
    skip: int,
    limit: int,
    granularity: Granularity,
    received: Optional[Dict[str, Any]] = None,
    *,
    total_count: Optional[int] = None,
    results_are_page: bool = False,
    info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
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
        info=info,
    )


def empty_entity_response(
    entity_type: str,
    set_id: str,
    granularity: Granularity,
    received: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return list_response(
        [],
        entity_type,
        set_id,
        0,
        1,
        granularity,
        received,
        total_count=0,
        results_are_page=True,
    )
