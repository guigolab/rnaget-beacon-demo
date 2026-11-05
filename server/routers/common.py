"""Shared router helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from beacon.responses import build_resultsets_response
from beacon.schemas.envelopes import Granularity
from routers.deps import MAX_PAGE_LIMIT, MAX_SKIP

# OpenAPI description for GET ``filters`` (CSV; POST uses filter arrays).
FILTERS_CSV_QUERY_DESCRIPTION = (
    "Comma-separated Beacon filters (RNAget GET convention). "
    "POST uses query.filters as a JSON array. "
    "symbol: filters match aliases/symbols with exact case (Alb ≠ ALB)."
)


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
