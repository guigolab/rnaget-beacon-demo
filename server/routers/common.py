"""Shared router helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from beacon.responses import build_resultsets_response
from beacon.schemas.envelopes import Granularity


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
